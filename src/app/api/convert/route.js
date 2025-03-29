// pages/api/convert/route.js (or wherever your file is)

import { NextResponse } from 'next/server';
import sharp from 'sharp';
import path from 'path';

// --- Configuration Constants ---
const MAX_FILE_SIZE_API = 100 * 1024 * 1024; // 100 MB in bytes (Keep this for file size)
const DEFAULT_QUALITY = 85; // Slightly increased default quality
const SUPPORTED_OUTPUT_FORMATS = ['webp', 'jpeg', 'png', 'avif', 'gif'];

// --- START: Sharp Configuration ---
// Increase Sharp's pixel limit significantly.
// Default is 268,403,894 pixels (~16k x 16k).
// Set to a much larger value (e.g., 2 billion pixels, ~45k x 45k).
// Use 'false' to disable the limit entirely (USE WITH CAUTION - potential memory issues on server).
// Choose a large number for a safer approach.
const MAX_SHARP_PIXELS = 2_000_000_000; // 2 Billion pixels
try {
    sharp.limitInputPixels(MAX_SHARP_PIXELS);
    console.log(`Sharp pixel limit set to: ${MAX_SHARP_PIXELS.toLocaleString()}`);
} catch (err) {
    // This might fail if sharp version is very old or in certain environments
    console.error("Failed to set Sharp pixel limit:", err);
    // Proceed with default limit if setting fails
}
// --- END: Sharp Configuration ---


// --- START: Next.js API Route Configuration ---
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '105mb', // Slightly larger than MAX_FILE_SIZE_API to accommodate overhead
        },
    },
};
// --- END: Next.js API Route Configuration ---

/**
 * Handles POST requests to convert multiple images.
 * @param {import('next/server').NextRequest} request The incoming request object.
 * @returns {Promise<NextResponse>} The response object containing results or errors.
 */
export async function POST(request) {
    const results = [];
    const errors = [];

    try {
        const formData = await request.formData();
        const files = formData.getAll('files');
        const outputFormat = formData.get('outputFormat')?.toLowerCase() || 'webp';

        // --- Input Validation ---
        if (!SUPPORTED_OUTPUT_FORMATS.includes(outputFormat)) {
            return NextResponse.json(
                { results: [], errors: [{ originalName: 'Invalid Request', error: `Output format "${outputFormat}" is not supported. Supported: ${SUPPORTED_OUTPUT_FORMATS.join(', ')}`, success: false }] },
                { status: 400 }
            );
        }
        if (!files || files.length === 0) {
            return NextResponse.json({ results: [], errors: [{ originalName: 'No Files', error: 'No files were uploaded.', success: false }] }, { status: 400 });
        }

        // --- Process Each Uploaded File ---
        for (const file of files) {
            if (!(file instanceof File)) {
                errors.push({ originalName: 'Unknown file', error: 'Received invalid file data.', success: false });
                continue;
            }

            const originalName = file.name || 'unknown_image';

            try {
                // --- Per-File Validations ---
                 if (file.size === 0) throw new Error('File is empty.');
                 if (!file.type.startsWith('image/')) throw new Error('Invalid file type (only images allowed).');
                 if (file.size > MAX_FILE_SIZE_API) {
                     throw new Error(`File size (${(file.size / 1024 / 1024).toFixed(2)} MB) exceeds server limit (${MAX_FILE_SIZE_API / 1024 / 1024} MB).`);
                 }

                // --- Image Conversion using Sharp ---
                const fileBuffer = Buffer.from(await file.arrayBuffer());

                // IMPORTANT: Create Sharp instance *after* limitInputPixels has been set globally
                const sharpInstance = sharp(fileBuffer, {
                    // Optionally enable sequentialRead for potentially lower memory usage on very large images
                    // sequentialRead: true // Uncomment if memory becomes an issue
                });

                let convertedBuffer;
                const metadata = await sharpInstance.metadata(); // Get metadata early if needed

                // Check dimensions *before* attempting conversion (optional but good practice)
                // Note: This check is now less critical since we increased the limit,
                // but it can catch *truly* gigantic images if MAX_SHARP_PIXELS is still finite.
                const currentPixels = (metadata.width || 0) * (metadata.height || 0);
                if (MAX_SHARP_PIXELS && currentPixels > MAX_SHARP_PIXELS) { // Check only if limit is not disabled (false)
                    throw new Error(`Image dimensions (${metadata.width}x${metadata.height}) exceed the configured pixel limit (${MAX_SHARP_PIXELS.toLocaleString()} pixels).`);
                }


                // Apply conversion based on format
                switch (outputFormat) {
                    case 'webp':
                        convertedBuffer = await sharpInstance.webp({ quality: DEFAULT_QUALITY }).toBuffer();
                        break;
                    case 'jpeg':
                    case 'jpg':
                        // Use metadata.hasAlpha if available, otherwise assume no alpha for safety
                        if (metadata.hasAlpha) {
                             convertedBuffer = await sharpInstance.flatten({ background: { r: 255, g: 255, b: 255 } }).jpeg({ quality: DEFAULT_QUALITY, mozjpeg: true }).toBuffer(); // Enable mozjpeg for better compression
                        } else {
                             convertedBuffer = await sharpInstance.jpeg({ quality: DEFAULT_QUALITY, mozjpeg: true }).toBuffer();
                        }
                        break;
                    case 'png':
                        // Higher compression level for PNG (lossless, slower)
                        convertedBuffer = await sharpInstance.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
                        break;
                    case 'avif':
                         // Higher quality for AVIF, 'effort' controls encoding speed vs compression
                        convertedBuffer = await sharpInstance.avif({ quality: 60, effort: 4 }).toBuffer(); // effort 0-9 (slowest/best compression)
                        break;
                    case 'gif':
                         // Add dither option for potentially better quality GIFs
                        convertedBuffer = await sharpInstance.gif({ dither: 0.5 }).toBuffer();
                        break;
                    default: // Should not happen due to earlier validation
                        throw new Error(`Internal error: Unsupported format ${outputFormat}`);
                }

                // --- Prepare Result Data ---
                const baseName = path.parse(originalName).name;
                const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_');
                const outputExtension = (outputFormat === 'jpeg') ? 'jpg' : outputFormat;
                const outputFilename = `${sanitizedBaseName}.${outputExtension}`;
                const mimeType = `image/${outputExtension}`;
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
                    // Provide more specific error if it's the pixel limit one
                    error: fileError.message?.includes('exceed') && fileError.message?.includes('pixel limit')
                        ? 'Image dimensions are too large for the server to process.'
                        : fileError.message || 'Failed to process this file.',
                    success: false,
                 });
            }
        } // End loop

        // --- Return Response ---
        return NextResponse.json({ results, errors }, { status: 200 });

    } catch (error) {
        console.error('API Global Error:', error);
        if (error.type === 'entity.too.large' || error.message?.includes('body exceeded') || error.message?.includes('too large')) {
             return NextResponse.json(
                 { results: [], errors: [{ originalName: 'Request Error', error: `Total upload size exceeds the server limit (${(config.api.bodyParser.sizeLimit || 'default')}). Please upload fewer or smaller files.`, success: false }] },
                 { status: 413 }
            );
        }
        return NextResponse.json(
             { results: [], errors: [{ originalName: 'Server Error', error: error.message || 'An unexpected server error occurred.', success: false }] },
             { status: 500 }
        );
    }
}

// --- GET Handler ---
export async function GET() {
    return NextResponse.json({ message: 'Image Converter API active. Send POST. Pixel limit: ' + (MAX_SHARP_PIXELS ? MAX_SHARP_PIXELS.toLocaleString() : 'Unlimited (Caution!)') }, { status: 200 });
}
