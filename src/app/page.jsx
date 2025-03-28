"use client";

import React, { useState, useRef, useEffect } from 'react';
import Swal from 'sweetalert2';
import JSZip from 'jszip'; // For creating ZIP files
import { saveAs } from 'file-saver'; // For triggering downloads

// --- Constants ---
const MAX_FILE_SIZE_MB = 15;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
// Define supported output formats (ensure backend API supports these via Sharp)
const SUPPORTED_FORMATS = ['webp', 'jpeg', 'png', 'avif', 'gif'];

// --- Helper Function ---
// Formats bytes into a human-readable string (KB, MB, GB...)
const formatBytes = (bytes, decimals = 2) => {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const index = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, index)).toFixed(dm))} ${sizes[index]}`;
};

// --- Main React Component ---
export default function PngConverterPage() {
    // --- State Variables ---
    // Holds the File objects selected by the user (before validation/conversion)
    const [selectedFiles, setSelectedFiles] = useState([]);
    // Stores the chosen output format (e.g., 'webp', 'jpeg')
    const [outputFormat, setOutputFormat] = useState('webp');
    // Stores the results from the backend API { outputName, dataUrl }
    const [convertedFiles, setConvertedFiles] = useState([]);
    // Tracks if the main conversion process is running
    const [isLoading, setIsLoading] = useState(false);
    // Tracks if the ZIP creation process is running
    const [isZipping, setIsZipping] = useState(false);

    // --- Refs ---
    // Reference to the actual <input type="file"> element
    const fileInputRef = useRef(null);
    // Reference holding the most up-to-date list of selected files (to avoid stale state in handlers)
    const latestSelectedFilesRef = useRef(selectedFiles);

    // --- Effect Hook ---
    // Keeps the latestSelectedFilesRef synchronized with the selectedFiles state
    useEffect(() => {
        latestSelectedFilesRef.current = selectedFiles;
    }, [selectedFiles]); // Re-run this effect whenever selectedFiles changes

    // --- Event Handlers ---

    // Called when the user selects files using the input element
    const handleFileChange = (event) => {
        setConvertedFiles([]); // Clear previous results when new files are selected
        const files = Array.from(event.target.files || []); // Get files from event

        // Validate each selected file
        const validFiles = [];
        let errors = [];
        files.forEach(file => {
            if (!file.type.startsWith('image/')) {
                errors.push(`"${file.name}" is not a recognized image type.`);
            } else if (file.size > MAX_FILE_SIZE_BYTES) {
                errors.push(`"${file.name}" (${formatBytes(file.size)}) exceeds the ${MAX_FILE_SIZE_MB} MB limit.`);
            } else {
                validFiles.push(file); // Add valid files to the list
            }
        });

        // Update the state with the list of valid files
        setSelectedFiles(validFiles);

        // Show an alert if some files were invalid and ignored
        if (errors.length > 0) {
            Swal.fire({
                icon: 'warning',
                title: 'Some files were ignored',
                html: errors.join('<br>'),
                customClass: { popup: 'swal2-popup' }
            });
        }
        // Note: We clear the input's value later in handleSubmit's finally block
    };

    // Called when the user changes the desired output format in the dropdown
    const handleFormatChange = (event) => {
        setOutputFormat(event.target.value);
    };

    // Called when the user clicks the main "Convert" button
    const handleSubmit = async (event) => {
        event.preventDefault(); // Prevent the browser's default form submission

        // Use the Ref for the check to ensure we have the latest file list
        if (latestSelectedFilesRef.current.length === 0) {
             Swal.fire({ icon: 'warning', title: 'No files selected', text: 'Please select one or more image files.', customClass: { popup: 'swal2-popup' } });
             return;
        }

        setIsLoading(true); // Indicate that conversion is starting
        setConvertedFiles([]); // Clear any previous conversion results

        // Prepare data to send to the backend API
        const formData = new FormData();
        latestSelectedFilesRef.current.forEach(file => formData.append('files', file)); // Add valid files
        formData.append('outputFormat', outputFormat); // Add selected format

        try {
            // Make the API call
            const response = await fetch('/api/convert', { method: 'POST', body: formData });

            // Handle potential errors from the server
            if (!response.ok) {
                 let errorMessage = `Server error: ${response.status} ${response.statusText}`;
                 try { // Try to get more specific error message from JSON response
                    const errorData = await response.json();
                    if (errorData?.error) errorMessage = errorData.error;
                 } catch (e) { /* Ignore if response isn't JSON */ }
                 throw new Error(errorMessage); // Trigger the catch block
            }

            // Process successful response
            const data = await response.json();
            const successfulConversions = data.results || [];
            const conversionErrors = data.errors || [];

            setConvertedFiles(successfulConversions); // Update state with results

            // Show notifications based on the conversion outcome
            if (conversionErrors.length > 0 && successfulConversions.length > 0) {
                 const errorHtml = conversionErrors.map(err => `<b>${err.originalName || 'Unknown file'}:</b> ${err.error}`).join('<br>');
                 Swal.fire({ icon: 'warning', title: 'Some completed, some failed', html: errorHtml, customClass: { popup: 'swal2-popup' } });
            } else if (conversionErrors.length > 0) {
                const errorHtml = conversionErrors.map(err => `<b>${err.originalName || 'Unknown file'}:</b> ${err.error}`).join('<br>');
                Swal.fire({ icon: 'error', title: 'Conversion Failed', html: errorHtml, customClass: { popup: 'swal2-popup' } });
            } else if (successfulConversions.length > 0) {
                 Swal.fire({ icon: 'success', title: 'Conversion Successful!', text: `${successfulConversions.length} file(s) ready.`, customClass: { popup: 'swal2-popup' } });
            } else {
                 Swal.fire({ icon: 'info', title: 'No files converted', text: 'Server returned no results.', customClass: { popup: 'swal2-popup' } });
            }

        } catch (err) { // Catch network errors or errors thrown above
            console.error('Conversion process error:', err);
            Swal.fire({ icon: 'error', title: 'Request Failed', text: err.message || 'An unexpected error occurred.', customClass: { popup: 'swal2-popup' } });
        } finally {
            setIsLoading(false); // Ensure loading state is turned off
            // Clear the actual file input element so the user can select same files again
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    // Called when a user clicks the download button for a single converted file
    const handleDownload = (dataUrl, filename) => {
        const link = document.createElement('a');
        link.href = dataUrl; // Use the Base64 Data URL
        link.setAttribute('download', filename); // Set the desired filename
        document.body.appendChild(link); // Add link to page
        link.click(); // Simulate click to trigger download
        document.body.removeChild(link); // Clean up the temporary link
    };

    // Called when the user clicks the "Download All as ZIP" button
    const handleDownloadAll = async () => {
        if (convertedFiles.length === 0) {
            Swal.fire({ icon: 'info', title: 'No files to zip', text: 'Convert some files first.', customClass: { popup: 'swal2-popup' } });
            return;
        }

        setIsZipping(true); // Indicate zipping has started
        Swal.fire({ // Show non-interactive loading alert
            title: 'Creating ZIP...',
            text: 'Please wait while files are compressed.',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); },
            customClass: { popup: 'swal2-popup' }
        });

        try {
            const zip = new JSZip(); // Create a new zip instance

            // Add each converted file to the zip archive
            convertedFiles.forEach(file => {
                const base64Data = file.dataUrl.split(',')[1]; // Get Base64 part of Data URL
                if (base64Data) {
                    // Add file using filename, base64 data, and indicating it's base64 encoded
                    zip.file(file.outputName, base64Data, { base64: true });
                } else {
                    console.warn(`Could not extract Base64 data for ${file.outputName}`);
                }
            });

            // Generate the zip file content asynchronously as a Blob
            const zipBlob = await zip.generateAsync({
                type: "blob",
                compression: "DEFLATE", // Use standard DEFLATE compression
                compressionOptions: { level: 6 } // Compression level (1-9)
            });

            // Use file-saver's saveAs function to trigger the download dialog
            saveAs(zipBlob, `converted_images_${outputFormat}.zip`); // Suggest a filename

            Swal.close(); // Close the loading alert

        } catch (error) { // Catch errors during zipping
            console.error("Error creating ZIP file:", error);
            Swal.fire({ icon: 'error', title: 'ZIP Creation Failed', text: error.message || 'Could not create ZIP.', customClass: { popup: 'swal2-popup' } });
        } finally {
            setIsZipping(false); // Ensure zipping state is turned off
        }
    };

    // --- JSX Rendering (The HTML structure) ---
    return (
        <main> {/* Main page container */}
            <div className="converter-card"> {/* The styled card */}
                <header>
                    <h1>
                        {/* Icon */}
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 10V3L4 14H11V21L20 10H13Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        <span>Freee Image Converter</span>
                    </h1>
                    <p className="subtitle">I hate paid converters so i built for free 😉  </p>
                    <p className="subtitle">Convert multiple images to WebP, JPEG, PNG, AVIF, GIF, and more.</p>
                </header>

                {/* The Form */}
                <form onSubmit={handleSubmit}>

                    {/* File Selection Section */}
                    <div className="form-section">
                        <label htmlFor="image_files">1. Select Image Files:</label>
                        <input
                            type="file" name="image_files" id="image_files"
                            ref={fileInputRef}      // Link input to the ref
                            required                // Browser validation: must select files
                            accept="image/*"        // Hint to browser: accept image files
                            multiple                // Allow multiple file selection
                            onChange={handleFileChange} // Call handler on change
                            disabled={isLoading}    // Disable while converting
                        />
                        <p className="help-text">Max file size per file: {MAX_FILE_SIZE_MB} MB. Batch upload supported.</p>
                    </div>

                    {/* Display List of Selected Files (conditionally rendered) */}
                    {selectedFiles.length > 0 && (
                        <div className="form-section">
                             <label>{selectedFiles.length} File(s) Selected:</label>
                            <ul className="file-list">
                                {/* Map over selected files to create list items */}
                                {selectedFiles.map((file, index) => (
                                    <li key={`${file.name}-${index}`}> {/* Unique key for React */}
                                        <span>{file.name}</span> {/* File name */}
                                        <span className="file-size">{formatBytes(file.size)}</span> {/* File size */}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Output Format Selection Section */}
                    <div className="form-section">
                         <label htmlFor="output_format">2. Choose Output Format:</label>
                         <select
                            id="output_format"
                            value={outputFormat} // Control dropdown value with state
                            onChange={handleFormatChange} // Update state on change
                            disabled={isLoading} // Disable while converting
                         >
                             {/* Generate options dynamically */}
                            {SUPPORTED_FORMATS.map(format => (
                                <option key={format} value={format}>{format.toUpperCase()}</option>
                            ))}
                         </select>
                    </div>

                    {/* Convert Button */}
                    <button
                        type="submit"
                        className="convert-button"
                        disabled={isLoading || selectedFiles.length === 0} // Disable if loading or no files
                    >
                        {isLoading ? ( // Show loading state
                            <>
                                <svg className="spinner" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Converting...
                            </>
                        ) : ( // Show normal state
                            <>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 5L21 12M21 12L14 19M21 12H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                {/* Dynamically show file count */}
                                Convert {selectedFiles.length > 0 ? `(${selectedFiles.length})` : ''} File(s)
                            </>
                        )}
                    </button>
                </form>

                {/* Results Display Area (conditionally rendered) */}
                {convertedFiles.length > 0 && (
                    <div className="results-area">
                        <h2>Conversion Results:</h2>
                        {/* Map over converted files to show each result */}
                        {convertedFiles.map((file, index) => (
                            <div key={`${file.outputName}-${index}`} className="result-item">
                                <div className="file-info">
                                    <span>{file.outputName}</span> {/* Converted filename */}
                                </div>
                                {/* Button to download this specific file */}
                                <button
                                    className="download-button"
                                    onClick={() => handleDownload(file.dataUrl, file.outputName)}
                                    disabled={isLoading || isZipping} // Disable while busy
                                >
                                     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 15L4 18C4 19.1046 4.89543 20 6 20L18 20C19.1046 20 20 19.1046 20 18V15M12 4L12 15M12 15L8 11M12 15L16 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                    Download
                                </button>
                            </div>
                        ))}

                        {/* Download All Button Container */}
                        <div className="download-all-container">
                            <button
                                type="button" // Crucial: Not type="submit"
                                className="download-all-button"
                                onClick={handleDownloadAll}
                                disabled={isLoading || isZipping || convertedFiles.length === 0} // Disable if busy or no results
                            >
                                {isZipping ? ( // Show zipping state
                                    <>
                                        <svg className="spinner" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                             <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                             <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Zipping...
                                    </>
                                ) : ( // Show normal state
                                    <>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 15V18C21 19.1046 20.1046 20 19 20H5C3.89543 20 3 19.1046 3 18V15M17 10L12 15M12 15L7 10M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                        Download All as ZIP
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {/* Footer */}
                <footer>
                Build With ❤️ From Saptrishi Free To Use As Much You Want | © {new Date().getFullYear()}
                </footer>
            </div>
        </main>
    );
}