import { NextResponse } from 'next/server';
import sharp from 'sharp';
import path from 'path';

// Configuration
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB (match frontend)
const DEFAULT_QUALITY = 80; // Default quality for lossy formats
const SUPPORTED_OUTPUT_FORMATS = ['webp','jpg', 'jpeg', 'png', 'avif',]; // Ensure backend supports these

/**
 * Handles POST requests to convert multiple images.
 * @param {import('next/server').NextRequest} request
 */
export async function POST(request) {
    const results = [];
    const errors = [];

    try {
        const formData = await request.formData();
        const files = formData.getAll('files'); // Get all files with key 'files'
        const outputFormat = formData.get('outputFormat')?.toLowerCase() || 'webp'; // Get output format, default webp

        // Validate output format
        if (!SUPPORTED_OUTPUT_FORMATS.includes(outputFormat)) {
            return NextResponse.json(
                { error: `Invalid output format specified. Supported formats: ${SUPPORTED_OUTPUT_FORMATS.join(', ')}` },
                { status: 400 }
            );
        }

        if (!files || files.length === 0) {
            return NextResponse.json({ error: 'No files uploaded.' }, { status: 400 });
        }

        // Process each file individually
        for (const file of files) {
            // Ensure it's a File object
            if (!(file instanceof File)) {
                errors.push({ originalName: 'Unknown file', error: 'Invalid file data received.', success: false });
                continue; // Skip to next file
            }

            const originalName = file.name || 'unknown_image';

            try {
                // File validations per file
                if (file.size === 0) {
                    throw new Error('File is empty.');
                }
                if (!file.type.startsWith('image/')) {
                     throw new Error('Invalid file type (not an image).');
                }
                if (file.size > MAX_FILE_SIZE) {
                    throw new Error(`File size exceeds limit (${MAX_FILE_SIZE / 1024 / 1024} MB).`);
                }

                const fileBuffer = Buffer.from(await file.arrayBuffer());
                let convertedBuffer;
                const sharpInstance = sharp(fileBuffer);

                // Apply conversion based on outputFormat
                switch (outputFormat) {
                    case 'webp':
                        convertedBuffer = await sharpInstance.webp({ quality: DEFAULT_QUALITY }).toBuffer();
                        break;
                    case 'jpeg':
                    case 'jpg': // Allow jpg alias
                         // Ensure image doesn't have alpha for JPEG or flatten it
                        const meta = await sharpInstance.metadata();
                        if (meta.hasAlpha) {
                             convertedBuffer = await sharpInstance.flatten({ background: { r: 255, g: 255, b: 255 } }).jpeg({ quality: DEFAULT_QUALITY }).toBuffer();
                        } else {
                             convertedBuffer = await sharpInstance.jpeg({ quality: DEFAULT_QUALITY }).toBuffer();
                        }
                        break;
                    case 'png':
                        convertedBuffer = await sharpInstance.png({ compressionLevel: 6 }).toBuffer(); // Adjust compression if needed
                        break;
                    case 'avif':
                         // AVIF quality is different (lower is better, 0-63 for lossy)
                        convertedBuffer = await sharpInstance.avif({ quality: 50 }).toBuffer();
                        break;
                    case 'gif':
                        convertedBuffer = await sharpInstance.gif().toBuffer();
                        break;
                    default:
                         // This shouldn't be reached due to initial validation, but as a fallback
                        throw new Error(`Unsupported output format: ${outputFormat}`);
                }

                // Generate output filename
                const baseName = path.parse(originalName).name;
                const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_');
                const outputFilename = `${sanitizedBaseName}.${outputFormat}`; // Use selected format extension

                // Create Base64 Data URL
                const mimeType = `image/${outputFormat === 'jpg' ? 'jpeg' : outputFormat}`;
                const dataUrl = `data:${mimeType};base64,${convertedBuffer.toString('base64')}`;

                results.push({
                    originalName: originalName,
                    outputName: outputFilename,
                    dataUrl: dataUrl,
                    success: true,
                });

            } catch (fileError) {
                 console.error(`Error processing ${originalName}:`, fileError);
                 errors.push({
                    originalName: originalName,
                    error: fileError.message || 'Failed to process file.',
                    success: false,
                 });
            }
        } // End of for loop

        // Return JSON response with results and errors
        return NextResponse.json({ results, errors }, { status: 200 });

    } catch (error) {
        // Catch broader errors (like formData parsing issues)
        console.error('API Global Error:', error);
        return NextResponse.json(
             { results: [], errors: [{ originalName: 'Request Error', error: error.message || 'Server error during file processing.', success: false }] },
             { status: 500 }
        );
    }
}

// Optional: Handle non-POST requests
export async function GET() {
    return NextResponse.json({ message: 'Send a POST request with image files to convert.' }, { status: 405 });
}