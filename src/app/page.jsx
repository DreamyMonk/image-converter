"use client";

import React, { useState, useRef, useEffect } from 'react';
import Swal from 'sweetalert2';
import JSZip from 'jszip'; // For creating ZIP files
import { saveAs } from 'file-saver'; // For triggering downloads

// --- Constants ---
const MAX_FILE_SIZE_MB = 100;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
// Sync this with the backend's MAX_SHARP_PIXELS!
const MAX_IMAGE_PIXELS = 2_000_000_000; // 2 Billion pixels (match backend)
// Define supported output formats (ensure backend API supports these via Sharp)
const SUPPORTED_FORMATS = ['webp', 'jpg', 'jpeg', 'png', 'avif', 'gif']; // Added gif to match backend

// --- Helper Function ---
// Formats bytes into a human-readable string (KB, MB, GB...)
const formatBytes = (bytes, decimals = 2) => {
  if (!+bytes) return '0 Bytes'; // Handle non-numeric or zero input
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  // Ensure index is within bounds
  const index = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, index)).toFixed(dm))} ${sizes[index]}`;
};

// --- Helper Function ---
// Function to get image dimensions (returns a Promise)
const getImageDimensions = (file) => {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) {
            return reject(new Error('Not an image file.'));
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                resolve({ width: img.naturalWidth, height: img.naturalHeight });
            };
            img.onerror = (err) => {
                reject(new Error('Could not load image data to get dimensions.'));
            };
            img.src = e.target.result;
        };
        reader.onerror = (err) => {
            reject(new Error('Could not read file.'));
        };
        reader.readAsDataURL(file);
    });
};


// --- Main React Component ---
export default function PngConverterPage() {
    // --- State Variables ---
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [outputFormat, setOutputFormat] = useState('webp');
    const [convertedFiles, setConvertedFiles] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isZipping, setIsZipping] = useState(false);

    // --- Refs ---
    const fileInputRef = useRef(null);
    // Using a ref for latest selectedFiles isn't strictly necessary anymore
    // with async handleFileChange, but harmless to keep if used elsewhere.

    // --- Event Handlers ---

    // Handles file selection - Appends new unique files with dimension checks
    const handleFileChange = async (event) => { // Make the handler async
        setConvertedFiles([]); // Clear previous results
        const newlySelectedRawFiles = Array.from(event.target.files || []);
        const currentFileIds = new Set(
            selectedFiles.map(f => `${f.name}-${f.size}-${f.lastModified}`)
        );

        let filesToAdd = [];
        let errors = [];
        let processingPromises = []; // Store promises for dimension checks

        newlySelectedRawFiles.forEach(file => {
            // --- Initial Synchronous Checks ---
            if (currentFileIds.has(`${file.name}-${file.size}-${file.lastModified}`)) {
                // Skip duplicate silently or add a notice if preferred
                return;
            }
            if (!file.type.startsWith('image/')) {
                errors.push(`"${file.name}" (ignored): Not an image.`);
                return;
            }
            if (file.size > MAX_FILE_SIZE_BYTES) {
                errors.push(`"${file.name}" (${formatBytes(file.size)}) (ignored): Exceeds ${MAX_FILE_SIZE_MB} MB file size limit.`);
                return;
            }

            // --- Asynchronous Dimension Check ---
            const dimensionPromise = getImageDimensions(file)
                .then(dimensions => {
                    const pixelCount = dimensions.width * dimensions.height;
                    // Check against the updated, larger pixel limit
                    if (MAX_IMAGE_PIXELS && pixelCount > MAX_IMAGE_PIXELS) { // Check only if limit is not zero/false
                         errors.push(`"${file.name}" (${dimensions.width}x${dimensions.height}) (ignored): Exceeds image dimension limit (${(MAX_IMAGE_PIXELS / 1_000_000).toFixed(0)} Million pixels).`);
                    } else {
                        // Only add if all checks pass
                        filesToAdd.push(file);
                    }
                })
                .catch(err => {
                     // Don't add the file if dimension check fails
                     errors.push(`"${file.name}" (ignored): Error checking dimensions - ${err.message}`);
                });

            processingPromises.push(dimensionPromise);
        });

        // Wait for all dimension checks to complete
        // Using allSettled ensures we process all files even if some checks fail
        await Promise.allSettled(processingPromises);

        // Update state after all checks
        if (filesToAdd.length > 0) {
            setSelectedFiles(prevFiles => {
                // Another de-duplication check just in case async operations caused races
                const existingIds = new Set(prevFiles.map(f => `${f.name}-${f.size}-${f.lastModified}`));
                const trulyNewFiles = filesToAdd.filter(newFile => !existingIds.has(`${newFile.name}-${newFile.size}-${newFile.lastModified}`));
                return [...prevFiles, ...trulyNewFiles];
            });
        }

        // Show errors accumulated during the process
        if (errors.length > 0) {
            Swal.fire({
                icon: 'warning',
                title: 'Some files were ignored',
                html: errors.join('<br>'),
                customClass: { popup: 'swal2-popup' } // Ensure class is applied
            });
        }

        // Clear the input value field *after* processing
        if (fileInputRef.current) {
           fileInputRef.current.value = ''; // Clear the selection visually
        }
    };


    // Removes a single selected file
    const handleDeselectFile = (indexToRemove) => {
        setSelectedFiles(prevFiles => prevFiles.filter((_, index) => index !== indexToRemove));
        setConvertedFiles([]); // Clear results if selection changes
    };

    // Clears the entire file selection
    const handleClearAll = () => {
        setSelectedFiles([]);
        setConvertedFiles([]);
        if (fileInputRef.current) { fileInputRef.current.value = ''; }
    };

    // Handles changing the target output format
    const handleFormatChange = (event) => {
        setOutputFormat(event.target.value);
        setConvertedFiles([]); // Clear results if format changes
    };

    // Handles the main conversion process
    const handleSubmit = async (event) => {
        event.preventDefault();
        // Use selectedFiles directly from state now
        if (selectedFiles.length === 0) {
            Swal.fire({ icon: 'warning', title: 'No files selected', text: 'Please select one or more image files.', customClass: { popup: 'swal2-popup' } });
            return;
        }
        setIsLoading(true);
        setConvertedFiles([]); // Clear previous results before new conversion
        const formData = new FormData();
        selectedFiles.forEach(file => formData.append('files', file));
        formData.append('outputFormat', outputFormat);

        try {
            const response = await fetch('/api/convert', { method: 'POST', body: formData });

            // Improved error message parsing from backend
            let errorMessage = `Server error: ${response.status} ${response.statusText}`;
            let errorHtml = ''; // For displaying multiple errors from backend
            if (!response.ok) {
                 try {
                    const errorData = await response.json();
                    if (errorData?.errors && Array.isArray(errorData.errors) && errorData.errors.length > 0) {
                        // Format multiple errors nicely
                        errorHtml = errorData.errors.map(err => `<b>${err.originalName || 'Request Error'}:</b> ${err.error}`).join('<br>');
                        errorMessage = `Conversion failed for ${errorData.errors.length > 1 ? 'multiple files' : 'a file'}.`; // More generic title
                    } else if (errorData?.error) {
                         errorMessage = errorData.error; // Single top-level error
                         errorHtml = errorMessage;
                    }
                 } catch (e) { /* Ignore JSON parsing errors, stick with status text */ }

                 // Throw error to be caught below
                 throw new Error(errorMessage); // Use the refined message
            }

            const data = await response.json();
            const successfulConversions = data.results || [];
            const conversionErrors = data.errors || []; // Errors reported by the backend per-file

            setConvertedFiles(successfulConversions);

            // Notifications based on results
            if (conversionErrors.length > 0 && successfulConversions.length > 0) {
                 errorHtml = conversionErrors.map(err => `<b>${err.originalName || 'Unknown file'}:</b> ${err.error}`).join('<br>');
                 Swal.fire({ icon: 'warning', title: 'Completed with Issues', html: `Successfully converted ${successfulConversions.length} file(s).<br><br><b>Errors:</b><br>${errorHtml}`, customClass: { popup: 'swal2-popup' } });
            } else if (conversionErrors.length > 0) {
                errorHtml = conversionErrors.map(err => `<b>${err.originalName || 'Unknown file'}:</b> ${err.error}`).join('<br>');
                Swal.fire({ icon: 'error', title: 'Conversion Failed', html: errorHtml, customClass: { popup: 'swal2-popup' } });
            } else if (successfulConversions.length > 0) {
                 Swal.fire({ icon: 'success', title: 'Conversion Successful!', text: `${successfulConversions.length} file(s) converted to ${outputFormat.toUpperCase()} and ready for download.`, customClass: { popup: 'swal2-popup' } });
            } else {
                 // This case should be rare if backend validation is good
                 Swal.fire({ icon: 'info', title: 'No files converted', text: 'The server processed the request but returned no converted files.', customClass: { popup: 'swal2-popup' } });
            }
        } catch (err) {
            // Catch fetch errors or errors thrown from !response.ok block
            console.error('Conversion process error:', err);
            Swal.fire({
                icon: 'error',
                title: 'Request Failed',
                 // Use errorHtml if available (for formatted backend errors), otherwise use err.message
                html: errorHtml || err.message || 'An unexpected error occurred during the request.',
                customClass: { popup: 'swal2-popup' }
            });
        } finally {
            setIsLoading(false);
            // Keep selected files, don't clear input here - allows re-trying conversion with different format
            // if (fileInputRef.current) { fileInputRef.current.value = ''; } // Removed this line
        }
    };

    // Handles download for a single file
    const handleDownload = (dataUrl, filename) => {
        try {
            saveAs(dataUrl, filename); // Use file-saver directly
        } catch (error) {
            console.error("Download failed:", error);
            Swal.fire({ icon: 'error', title: 'Download Failed', text: 'Could not initiate file download.', customClass: { popup: 'swal2-popup' } });
        }
    };


    // Handles creating and downloading all converted files as a ZIP
    const handleDownloadAll = async () => {
        if (convertedFiles.length === 0) {
            Swal.fire({ icon: 'info', title: 'No files to zip', text: 'Convert some files first.', customClass: { popup: 'swal2-popup' } });
            return;
        }
        setIsZipping(true);
        Swal.fire({
            title: 'Creating ZIP...',
            text: `Adding ${convertedFiles.length} file(s)...`,
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); },
            customClass: { popup: 'swal2-popup' }
        });

        try {
            const zip = new JSZip();
            convertedFiles.forEach(file => {
                // Extract base64 data correctly
                const base64Data = file.dataUrl.substring(file.dataUrl.indexOf(',') + 1);
                if (base64Data && file.outputName) {
                    zip.file(file.outputName, base64Data, { base64: true });
                } else {
                    console.warn("Skipping file in ZIP due to missing data or name:", file.originalName);
                }
            });

            // Provide progress updates for large zips (optional but good UX)
            const zipBlob = await zip.generateAsync(
                {
                    type: "blob",
                    compression: "DEFLATE",
                    compressionOptions: { level: 6 } // 1 (fastest) - 9 (best compression)
                },
                (metadata) => { // Progress callback
                    // Update SweetAlert progress (optional)
                    const progress = metadata.percent.toFixed(0);
                    const loadingPopup = Swal.getHtmlContainer();
                    if (loadingPopup) {
                       const b = loadingPopup.querySelector('b');
                       if(b) b.textContent = `${progress}%`;
                    }
                    // Update text (more specific phase)
                     if (metadata.currentFile) {
                          Swal.update({ text: `Compressing: ${metadata.currentFile}...` });
                     } else if (progress < 100) {
                          Swal.update({ text: `Generating ZIP structure... ${progress}%` });
                     } else {
                          Swal.update({ text: `Finalizing ZIP file...` });
                     }
                }
            );

            saveAs(zipBlob, `converted_images_${outputFormat}.zip`);
            Swal.close(); // Close the "Zipping..." popup

        } catch (error) {
            console.error("Error creating ZIP file:", error);
            Swal.fire({ icon: 'error', title: 'ZIP Creation Failed', text: error.message || 'Could not create the ZIP file.', customClass: { popup: 'swal2-popup' } });
        } finally {
            setIsZipping(false);
        }
    };

    // --- JSX Structure ---
    return (
        <main>
            <div className="converter-card">
                <header>
                     <h1>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 10V3L4 14H11V21L20 10H13Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        {/* Corrected typo */}
                        <span>Free Image Converter</span>
                    </h1>
                    <p className="subtitle">I built this because paid converters are annoying 😉</p>
                    <p className="subtitle">Convert multiple images to WebP, JPEG, PNG, AVIF, and more </p>
                </header>

                <form onSubmit={handleSubmit}>

                    {/* File Selection Area */}
                    <div className="form-section">
                        <label htmlFor="image_files">1. Select or Drop Image Files:</label>
                        {/* Consider adding dropzone functionality later */}
                        <input
                            type="file"
                            name="image_files"
                            id="image_files"
                            ref={fileInputRef}
                            accept="image/*"
                            multiple
                            onChange={handleFileChange}
                            disabled={isLoading || isZipping}
                            aria-label="Select image files for conversion"
                         />
                        <p className="help-text">Max {MAX_FILE_SIZE_MB} MB per file. Add more files anytime.</p>
                         {/* Display updated pixel limit info */}
                        <p className="help-text">Max {(MAX_IMAGE_PIXELS / 1_000_000).toFixed(0)} Million pixels per image.</p>
                    </div>

                    {/* Selected Files List (Conditional) */}
                    {selectedFiles.length > 0 && (
                        <div className="form-section file-list-container"> {/* Added container class */}
                            <div className="file-list-header">
                                <label>{selectedFiles.length} File(s) Ready:</label>
                                <button type="button" className="clear-all-button" onClick={handleClearAll} disabled={isLoading || isZipping}> Clear All </button>
                            </div>
                            <ul className="file-list">
                                {selectedFiles.map((file, index) => (
                                    <li key={`${file.name}-${file.lastModified}-${index}`}> {/* More robust key */}
                                        <div className="file-details">
                                            <span className="file-name" title={file.name}>{file.name}</span> {/* Added title for long names */}
                                            <span className="file-size">{formatBytes(file.size)}</span>
                                        </div>
                                        <button
                                            type="button"
                                            className="deselect-button"
                                            onClick={() => handleDeselectFile(index)}
                                            disabled={isLoading || isZipping}
                                            aria-label={`Remove ${file.name}`}
                                        >
                                            × {/* Use HTML entity for 'x' */}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Output Format Selection */}
                    <div className="form-section">
                         <label htmlFor="output_format">2. Choose Output Format:</label>
                         <select
                             id="output_format"
                             value={outputFormat}
                             onChange={handleFormatChange}
                             disabled={isLoading || isZipping}
                             aria-label="Select the target image format"
                         >
                            {/* Ensure SUPPORTED_FORMATS is defined correctly */}
                            {SUPPORTED_FORMATS.map(format => (
                                <option key={format} value={format}>
                                    {format.toUpperCase()}
                                </option>
                            ))}
                         </select>
                    </div>

                    {/* Convert Button */}
                    <button
                        type="submit"
                        className="convert-button"
                        disabled={isLoading || isZipping || selectedFiles.length === 0}
                    >
                        {isLoading ? (
                            <>
                                {/* Simplified spinner SVG */}
                                <svg className="spinner" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeDasharray="31.415 31.415" strokeDashoffset="15.708"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" /></circle></svg>
                                Converting...
                            </>
                        ) : (
                            <>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 5L21 12M21 12L14 19M21 12H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                Convert {selectedFiles.length > 0 ? `(${selectedFiles.length}) File(s)` : 'Files'} {/* Improved text */}
                            </>
                        )}
                    </button>
                </form>

                {/* Results Area (Conditional) */}
                {convertedFiles.length > 0 && !isLoading && ( // Hide results while loading new batch
                    <div className="results-area">
                        <h2>Conversion Results ({outputFormat.toUpperCase()}):</h2>
                        {convertedFiles.map((file, index) => (
                            <div key={`${file.outputName}-${index}-result`} className="result-item">
                                <div className="file-info">
                                     <span title={file.outputName}>{file.outputName}</span>
                                     {/* Maybe show size reduction later */}
                                </div>
                                <button
                                    className="download-button"
                                    onClick={() => handleDownload(file.dataUrl, file.outputName)}
                                    disabled={isLoading || isZipping} // Redundant check, but safe
                                    aria-label={`Download ${file.outputName}`}
                                >
                                     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 15L4 18C4 19.1046 4.89543 20 6 20L18 20C19.1046 20 20 19.1046 20 18V15M12 4L12 15M12 15L8 11M12 15L16 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                    Download
                                </button>
                            </div>
                        ))}
                        {/* Download All Button Container */}
                        <div className="download-all-container">
                            <button
                                type="button"
                                className="download-all-button"
                                onClick={handleDownloadAll}
                                disabled={isZipping || convertedFiles.length === 0} // Disable only when zipping or no files
                                aria-label="Download all converted files as a ZIP archive"
                            >
                                {isZipping ? (
                                    <>
                                        {/* Same simplified spinner */}
                                        <svg className="spinner" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeDasharray="31.415 31.415" strokeDashoffset="15.708"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" /></circle></svg>
                                        Zipping... <span className="zip-progress"><b>0%</b></span> {/* Add progress placeholder */}
                                    </>
                                ) : (
                                    <>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 15V18C21 19.1046 20.1046 20 19 20H5C3.89543 20 3 19.1046 3 18V15M17 10L12 15M12 15L7 10M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                        Download All ({convertedFiles.length}) as ZIP
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )} {/* End Results Area */}

                <footer>
                 Build With ❤️ From Saptrishi | Free To Use | © {new Date().getFullYear()}
                 </footer>
            </div> {/* End converter-card */}
        </main>
    );
}
