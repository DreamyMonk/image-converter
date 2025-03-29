import { NextResponse } from 'next/server';
import sharp from 'sharp';
import path from 'path';

// --- Configuration Constants ---
const MAX_FILE_SIZE_API = 100 * 1024 * 1024; // API Limit: 100 MB in bytes
const DEFAULT_QUALITY = 80; // Default quality for lossy formats like JPEG, WebP
// Ensure backend supports these formats (Sharp needs to be compiled with support)
const SUPPORTED_OUTPUT_FORMATS = ['webp', 'jpeg', 'png', 'avif', 'gif'];

// --- START: Next.js API Route Configuration ---
// This configures Next.js specific settings for this API route
export const config = {
    api: {
        bodyParser: {
            // Increase the maximum request body size allowed for this route
            sizeLimit: `${MAX_FILE_SIZE_API}b`, // Set limit using the constant (e.g., "104857600b")
        },
        // Note: Vercel and other platforms might have their own stricter limits
        // that override this setting during deployment. Check platform docs.
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
        // Parse the incoming form data
        const formData = await request.formData();
        const files = formData.getAll('files'); // Get all files uploaded with the key 'files'
        const outputFormat = formData.get('outputFormat')?.toLowerCase() || 'webp'; // Get selected format, default to webp

        // --- Input Validation ---

        // Validate the requested output format
        if (!SUPPORTED_OUTPUT_FORMATS.includes(outputFormat)) {
            return NextResponse.json(
                { results: [], errors: [{ originalName: 'Invalid Request', error: `Output format "${outputFormat}" is not supported. Supported: ${SUPPORTED_OUTPUT_FORMATS.join(', ')}`, success: false }] },
                { status: 400 } // Bad Request status
            );
        }

        // Check if any files were actually uploaded
        if (!files || files.length === 0) {
            return NextResponse.json({ results: [], errors: [{ originalName: 'No Files', error: 'No files were uploaded in the request.', success: false }] }, { status: 400 });
        }

        // --- Process Each Uploaded File ---
        for (const file of files) {
            // Basic check if it's a File object (robustness)
            if (!(file instanceof File)) {
                errors.push({ originalName: 'Unknown file', error: 'Received invalid file data.', success: false });
                continue; // Skip this item and proceed to the next file
            }

            const originalName = file.name || 'unknown_image'; // Get original filename

            try {
                // --- Per-File Validations ---
                 if (file.size === 0) {
                    throw new Error('File is empty.');
                 }
                 // Check MIME type (basic check, more robust checks are possible)
                 if (!file.type.startsWith('image/')) {
                     throw new Error('Invalid file type (only images are allowed).');
                 }
                // Check individual file size against the API limit
                if (file.size > MAX_FILE_SIZE_API) {
                    throw new Error(`File size (${(file.size / 1024 / 1024).toFixed(2)} MB) exceeds the server limit (${MAX_FILE_SIZE_API / 1024 / 1024} MB).`);
                }

                // --- Image Conversion using Sharp ---
                const fileBuffer = Buffer.from(await file.arrayBuffer()); // Read file into a buffer
                let convertedBuffer;
                const sharpInstance = sharp(fileBuffer); // Load buffer into Sharp

                // Apply conversion based on the selected outputFormat
                switch (outputFormat) {
                    case 'webp':
                        convertedBuffer = await sharpInstance.webp({ quality: DEFAULT_QUALITY }).toBuffer();
                        break;
                    case 'jpeg':
                    case 'jpg': // Allow 'jpg' as an alias for 'jpeg'
                         // JPEG does not support transparency, flatten if needed
                        const meta = await sharpInstance.metadata();
                        if (meta.hasAlpha) {
                             // Flatten with a white background
                             convertedBuffer = await sharpInstance.flatten({ background: { r: 255, g: 255, b: 255 } }).jpeg({ quality: DEFAULT_QUALITY }).toBuffer();
                        } else {
                             convertedBuffer = await sharpInstance.jpeg({ quality: DEFAULT_QUALITY }).toBuffer();
                        }
                        break;
                    case 'png':
                        // PNG quality is lossless, compressionLevel affects size vs time
                        convertedBuffer = await sharpInstance.png({ compressionLevel: 6 }).toBuffer();
                        break;
                    case 'avif':
                         // AVIF quality scale is different, lower means higher quality usually
                        convertedBuffer = await sharpInstance.avif({ quality: 50 }).toBuffer(); // Adjust quality as needed
                        break;
                    case 'gif':
                        // Basic GIF conversion (Sharp's GIF support might be limited compared to specialized tools)
                        convertedBuffer = await sharpInstance.gif().toBuffer();
                        break;
                    default:
                         // Fallback, though should be caught by initial validation
                        throw new Error(`Internal error: Unsupported format ${outputFormat}`);
                }

                // --- Prepare Result Data ---
                const baseName = path.parse(originalName).name; // Get filename without extension
                const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_'); // Basic sanitization
                // Use correct extension for output format ('jpg' for 'jpeg')
                const outputExtension = (outputFormat === 'jpeg') ? 'jpg' : outputFormat;
                const outputFilename = `${sanitizedBaseName}.${outputExtension}`;

                // Create Base64 Data URL for sending back to the client
                const mimeType = `image/${outputExtension}`; // Correct MIME type
                const dataUrl = `data:${mimeType};base64,${convertedBuffer.toString('base64')}`;

                // Add successful result to the results array
                results.push({
                    originalName: originalName,
                    outputName: outputFilename,
                    dataUrl: dataUrl, // The Base64 string representing the image
                    success: true,
                });

            } catch (fileError) {
                 // Handle errors specific to processing a single file
                 console.error(`Error processing ${originalName}:`, fileError);
                 errors.push({
                    originalName: originalName,
                    error: fileError.message || 'Failed to process this file.',
                    success: false,
                 });
            }
        } // --- End of file processing loop ---

        // --- Return Successful Response (with potential partial errors) ---
        // Send back JSON containing both successful results and any errors encountered
        return NextResponse.json({ results, errors }, { status: 200 });

    } catch (error) {
        // --- Catch Global Errors (e.g., formData parsing, unexpected issues) ---
        console.error('API Global Error:', error);

        // Check if the error seems to be due to exceeding the body size limit
        // Note: The exact error properties might vary slightly.
        if (error.type === 'entity.too.large' || error.message?.includes('body exceeded') || error.message?.includes('too large')) {
             return NextResponse.json(
                 {
                    results: [],
                    errors: [{ originalName: 'Request Error', error: `Total upload size exceeds the server limit (${MAX_FILE_SIZE_API / 1024 / 1024} MB). Please upload fewer or smaller files.`, success: false }]
                 },
                 { status: 413 } // HTTP 413 Payload Too Large
            );
        }

        // Handle other generic server errors
        return NextResponse.json(
             {
                results: [],
                errors: [{ originalName: 'Server Error', error: error.message || 'An unexpected server error occurred.', success: false }]
             },
             { status: 500 } // HTTP 500 Internal Server Error
        );
    }
}

// --- GET Handler (Optional - useful for testing endpoint availability) ---
export async function GET() {
    return NextResponse.json({ message: 'API is active. Send a POST request with image files to convert.' }, { status: 200 });
}
