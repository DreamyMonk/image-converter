import { NextResponse } from 'next/server';
import sharp from 'sharp';
import path from 'path';

// --- Configuration Constants ---
// Constant for runtime checks (per-file validation)
const MAX_FILE_SIZE_API = 100 * 1024 * 1024; // 100 MB in bytes
const DEFAULT_QUALITY = 80; // Default quality for lossy formats
const SUPPORTED_OUTPUT_FORMATS = ['webp', 'jpeg', 'png', 'avif', 'gif'];

// --- START: Next.js API Route Configuration ---
// Configure Next.js specific settings for this API route
export const config = {
    api: {
        bodyParser: {
            // Increase the maximum request body size allowed.
            // MUST be a string literal for static analysis by Next.js build.
            sizeLimit: '100mb', // Correctly set as a string literal
        },
        // Note: Deployment platforms like Vercel (Hobby plan) might enforce
        // their own lower limits (e.g., 4.5MB) which override this setting.
    },
};
// --- END: Next.js API Route Configuration ---

/**
 * Handles POST requests to convert multiple images.
 * @param {import('next/server').NextRequest} request The incoming request object.
 * @returns {Promise<NextResponse>} The response object containing results or errors.
 */
export async function POST(request) {
    // Arrays to hold results and errors for batch processing
    const results = [];
    const errors = [];

    try {
        // Parse the incoming form data (handles multipart/form-data)
        const formData = await request.formData();
        const files = formData.getAll('files'); // Get all files associated with the 'files' key
        const outputFormat = formData.get('outputFormat')?.toLowerCase() || 'webp'; // Get selected format, default to webp

        // --- Input Validation ---

        // Validate the requested output format against supported list
        if (!SUPPORTED_OUTPUT_FORMATS.includes(outputFormat)) {
            return NextResponse.json(
                { results: [], errors: [{ originalName: 'Invalid Request', error: `Output format "${outputFormat}" is not supported. Supported: ${SUPPORTED_OUTPUT_FORMATS.join(', ')}`, success: false }] },
                { status: 400 } // Bad Request
            );
        }

        // Check if any files were uploaded
        if (!files || files.length === 0) {
            return NextResponse.json({ results: [], errors: [{ originalName: 'No Files', error: 'No files were uploaded in the request.', success: false }] }, { status: 400 });
        }

        // --- Process Each Uploaded File ---
        // Use a for...of loop for async operations inside
        for (const file of files) {
            // Check if the item is actually a File object
            if (!(file instanceof File)) {
                errors.push({ originalName: 'Unknown file', error: 'Received invalid file data.', success: false });
                continue; // Skip this item
            }

            const originalName = file.name || 'unknown_image'; // Get filename

            try {
                // --- Per-File Validations ---
                 if (file.size === 0) {
                    throw new Error('File is empty.');
                 }
                 if (!file.type.startsWith('image/')) {
                     throw new Error('Invalid file type (only images are allowed).');
                 }
                // Validate individual file size against the runtime constant
                if (file.size > MAX_FILE_SIZE_API) {
                    throw new Error(`File size (${(file.size / 1024 / 1024).toFixed(2)} MB) exceeds the server limit (${MAX_FILE_SIZE_API / 1024 / 1024} MB).`);
                }

                // --- Image Conversion using Sharp ---
                const fileBuffer = Buffer.from(await file.arrayBuffer()); // Read file content into a Buffer
                let convertedBuffer;
                const sharpInstance = sharp(fileBuffer); // Initialize Sharp

                // Apply the correct Sharp conversion method based on the format
                switch (outputFormat) {
                    case 'webp':
                        convertedBuffer = await sharpInstance.webp({ quality: DEFAULT_QUALITY }).toBuffer();
                        break;
                    case 'jpeg':
                    case 'jpg':
                        const meta = await sharpInstance.metadata();
                        if (meta.hasAlpha) { // Flatten if image has transparency
                             convertedBuffer = await sharpInstance.flatten({ background: { r: 255, g: 255, b: 255 } }).jpeg({ quality: DEFAULT_QUALITY }).toBuffer();
                        } else {
                             convertedBuffer = await sharpInstance.jpeg({ quality: DEFAULT_QUALITY }).toBuffer();
                        }
                        break;
                    case 'png':
                        convertedBuffer = await sharpInstance.png({ compressionLevel: 6 }).toBuffer();
                        break;
                    case 'avif':
                        convertedBuffer = await sharpInstance.avif({ quality: 50 }).toBuffer();
                        break;
                    case 'gif':
                        convertedBuffer = await sharpInstance.gif().toBuffer();
                        break;
                    default:
                        throw new Error(`Internal error: Unsupported format ${outputFormat}`);
                }

                // --- Prepare Result Data ---
                const baseName = path.parse(originalName).name;
                const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_');
                const outputExtension = (outputFormat === 'jpeg') ? 'jpg' : outputFormat;
                const outputFilename = `${sanitizedBaseName}.${outputExtension}`;

                // Create Base64 Data URL to send back to the client for download
                const mimeType = `image/${outputExtension}`;
                const dataUrl = `data:${mimeType};base64,${convertedBuffer.toString('base64')}`;

                // Add successful conversion details to the results array
                results.push({
                    originalName: originalName,
                    outputName: outputFilename,
                    dataUrl: dataUrl,
                    success: true,
                });

            } catch (fileError) {
                 // Catch errors during processing of *this specific file*
                 console.error(`Error processing ${originalName}:`, fileError);
                 errors.push({
                    originalName: originalName,
                    error: fileError.message || 'Failed to process this file.',
                    success: false,
                 });
                 // Continue to the next file even if one fails
            }
        } // --- End of file processing loop ---

        // --- Return Response ---
        // Send JSON containing both successful results and any errors
        return NextResponse.json({ results, errors }, { status: 200 });

    } catch (error) {
        // --- Catch Global Errors ---
        // Errors like parsing formData, unexpected server issues
        console.error('API Global Error:', error);

        // Attempt to identify and specifically handle "Payload Too Large" errors
        if (error.type === 'entity.too.large' || error.message?.includes('body exceeded') || error.message?.includes('too large')) {
             return NextResponse.json(
                 {
                    results: [],
                    errors: [{ originalName: 'Request Error', error: `Total upload size exceeds the server limit (${MAX_FILE_SIZE_API / 1024 / 1024} MB). Please upload fewer or smaller files.`, success: false }]
                 },
                 { status: 413 } // HTTP 413 Payload Too Large
            );
        }

        // Fallback for other types of server errors
        return NextResponse.json(
             {
                results: [],
                errors: [{ originalName: 'Server Error', error: error.message || 'An unexpected server error occurred.', success: false }]
             },
             { status: 500 } // HTTP 500 Internal Server Error
        );
    }
}

// --- GET Handler ---
// Handles GET requests to this endpoint (e.g., for simple health check)
export async function GET() {
    return NextResponse.json({ message: 'Image Converter API is active. Send POST requests with files.' }, { status: 200 });
}
