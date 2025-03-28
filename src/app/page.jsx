"use client";

import React, { useState, useRef, useEffect } from 'react';
import Swal from 'sweetalert2';
import JSZip from 'jszip'; // For creating ZIP files
import { saveAs } from 'file-saver'; // For triggering downloads

// --- Constants ---
const MAX_FILE_SIZE_MB = 15;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
// Define supported output formats (ensure backend API supports these via Sharp)
const SUPPORTED_FORMATS = ['webp', 'jpg', 'jpeg', 'png', 'avif',];

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
    const latestSelectedFilesRef = useRef(selectedFiles);

    // --- Effect Hook ---
    // Keeps the Ref synchronized with the State
    useEffect(() => {
        latestSelectedFilesRef.current = selectedFiles;
    }, [selectedFiles]);

    // --- Event Handlers ---

    // Handles file selection - Appends new unique files
    const handleFileChange = (event) => {
        setConvertedFiles([]);
        const newlySelectedRawFiles = Array.from(event.target.files || []);
        const currentFiles = selectedFiles; // Use current state for deduplication check
        const newlyValidFiles = [];
        let errors = [];
        newlySelectedRawFiles.forEach(file => {
            if (!file.type.startsWith('image/')) { errors.push(`"${file.name}" (ignored): Not an image.`); }
            else if (file.size > MAX_FILE_SIZE_BYTES) { errors.push(`"${file.name}" (${formatBytes(file.size)}) (ignored): Exceeds ${MAX_FILE_SIZE_MB} MB limit.`); }
            else { newlyValidFiles.push(file); }
        });
        const currentFileIds = new Set( currentFiles.map(f => `${f.name}-${f.size}-${f.lastModified}`) );
        const filesToAdd = newlyValidFiles.filter( newFile => !currentFileIds.has(`${newFile.name}-${newFile.size}-${newFile.lastModified}`) );
        setSelectedFiles(prevFiles => [...prevFiles, ...filesToAdd]); // Append new valid files
        if (errors.length > 0) { Swal.fire({ icon: 'warning', title: 'Some files were ignored', html: errors.join('<br>'), customClass: { popup: 'swal2-popup' } }); }
    };

    // Removes a single selected file
    const handleDeselectFile = (indexToRemove) => {
        setSelectedFiles(prevFiles => prevFiles.filter((_, index) => index !== indexToRemove));
    };

    // Clears the entire file selection
    const handleClearAll = () => {
        setSelectedFiles([]);
        setConvertedFiles([]);
        if (fileInputRef.current) { fileInputRef.current.value = ''; }
    };

    // Handles changing the target output format
    const handleFormatChange = (event) => { setOutputFormat(event.target.value); };

    // Handles the main conversion process
    const handleSubmit = async (event) => {
        event.preventDefault();
        if (latestSelectedFilesRef.current.length === 0) { Swal.fire({ icon: 'warning', title: 'No files selected', text: 'Please select one or more files.', customClass: { popup: 'swal2-popup' } }); return; }
        setIsLoading(true);
        setConvertedFiles([]);
        const formData = new FormData();
        latestSelectedFilesRef.current.forEach(file => formData.append('files', file));
        formData.append('outputFormat', outputFormat);
        try {
            const response = await fetch('/api/convert', { method: 'POST', body: formData });
            if (!response.ok) {
                 let errorMessage = `Server error: ${response.status} ${response.statusText}`;
                 try { const errorData = await response.json(); if (errorData?.error) errorMessage = errorData.error; } catch (e) { /* Ignore */ }
                 throw new Error(errorMessage);
            }
            const data = await response.json();
            const successfulConversions = data.results || [];
            const conversionErrors = data.errors || [];
            setConvertedFiles(successfulConversions);
            // Notifications based on results
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
        } catch (err) {
            console.error('Conversion process error:', err);
            Swal.fire({ icon: 'error', title: 'Request Failed', text: err.message || 'An unexpected error occurred.', customClass: { popup: 'swal2-popup' } });
        } finally {
            setIsLoading(false);
            if (fileInputRef.current) { fileInputRef.current.value = ''; }
        }
    };

    // Handles download for a single file
    const handleDownload = (dataUrl, filename) => {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Handles creating and downloading all converted files as a ZIP
    const handleDownloadAll = async () => {
        if (convertedFiles.length === 0) { Swal.fire({ icon: 'info', title: 'No files to zip', text: 'Convert some files first.', customClass: { popup: 'swal2-popup' } }); return; }
        setIsZipping(true);
        Swal.fire({ title: 'Creating ZIP...', text: 'Please wait...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); }, customClass: { popup: 'swal2-popup' } });
        try {
            const zip = new JSZip();
            convertedFiles.forEach(file => {
                const base64Data = file.dataUrl.split(',')[1];
                if (base64Data) { zip.file(file.outputName, base64Data, { base64: true }); }
            });
            const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
            saveAs(zipBlob, `converted_images_${outputFormat}.zip`);
            Swal.close();
        } catch (error) {
            console.error("Error creating ZIP file:", error);
            Swal.fire({ icon: 'error', title: 'ZIP Failed', text: error.message || 'Could not create ZIP.', customClass: { popup: 'swal2-popup' } });
        } finally {
            setIsZipping(false);
        }
    };

    // --- JSX Structure ---
    return (
        <main> {/* Root element for the page */}
            <div className="converter-card"> {/* Main UI card */}
                <header> {/* Header section */}
                     <h1>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 10V3L4 14H11V21L20 10H13Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        <span>Freee Image Converter</span>
                    </h1>
                    <p className="subtitle">I hate paid converters so i built for free 😉  </p>
                    <p className="subtitle">Convert multiple images to WebP, JPEG, PNG, AVIF, GIF, and more.</p>
                </header>

                <form onSubmit={handleSubmit}> {/* Form element */}

                    {/* File Selection Area */}
                    <div className="form-section">
                        <label htmlFor="image_files">1. Select Image Files:</label>
                        <input type="file" name="image_files" id="image_files" ref={fileInputRef} accept="image/*" multiple onChange={handleFileChange} disabled={isLoading || isZipping} />
                        <p className="help-text">Max file size per file: {MAX_FILE_SIZE_MB} MB. Add more files anytime.</p>
                    </div>

                    {/* Selected Files List (Conditional) */}
                    {selectedFiles.length > 0 && (
                        <div className="form-section">
                            <div className="file-list-header">
                                <label>{selectedFiles.length} File(s) Selected:</label>
                                <button type="button" className="clear-all-button" onClick={handleClearAll} disabled={isLoading || isZipping}> Clear All </button>
                            </div>
                            <ul className="file-list">
                                {selectedFiles.map((file, index) => (
                                    <li key={`${file.name}-${file.lastModified}-${index}`}>
                                        <div className="file-details">
                                            <span className="file-name">{file.name}</span>
                                            <span className="file-size">{formatBytes(file.size)}</span>
                                        </div>
                                        {/* --- Deselect Button - Ensure closing tag --- */}
                                        <button type="button" className="deselect-button" onClick={() => handleDeselectFile(index)} disabled={isLoading || isZipping} aria-label={`Remove ${file.name}`}>×</button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Output Format Selection */}
                    <div className="form-section">
                         <label htmlFor="output_format">2. Choose Output Format:</label>
                         <select id="output_format" value={outputFormat} onChange={handleFormatChange} disabled={isLoading || isZipping}>
                            {SUPPORTED_FORMATS.map(format => ( <option key={format} value={format}>{format.toUpperCase()}</option> ))}
                         </select>
                    </div>

                    {/* Convert Button - Ensure closing tag */}
                    <button type="submit" className="convert-button" disabled={isLoading || isZipping || selectedFiles.length === 0}>
                        {isLoading ? (
                            <>
                                <svg className="spinner" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Converting...
                            </>
                        ) : (
                            <>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M14 5L21 12M21 12L14 19M21 12H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                                Convert {selectedFiles.length > 0 ? `(${selectedFiles.length})` : ''} File(s)
                            </>
                        )}
                    </button> {/* --- Closing tag for Convert button --- */}
                </form> {/* Closing tag for form */}

                {/* Results Area (Conditional) */}
                {convertedFiles.length > 0 && (
                    <div className="results-area">
                        <h2>Conversion Results:</h2>
                        {convertedFiles.map((file, index) => (
                            <div key={`${file.outputName}-${index}-result`} className="result-item">
                                <div className="file-info"><span>{file.outputName}</span></div>
                                {/* --- Individual Download Button - Ensure closing tag --- */}
                                <button className="download-button" onClick={() => handleDownload(file.dataUrl, file.outputName)} disabled={isLoading || isZipping}>
                                     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 15L4 18C4 19.1046 4.89543 20 6 20L18 20C19.1046 20 20 19.1046 20 18V15M12 4L12 15M12 15L8 11M12 15L16 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                    Download
                                </button> {/* --- Closing tag --- */}
                            </div>
                        ))}
                        {/* Download All Button Container */}
                        <div className="download-all-container">
                             {/* --- Download All Button - Ensure closing tag --- */}
                            <button type="button" className="download-all-button" onClick={handleDownloadAll} disabled={isLoading || isZipping || convertedFiles.length === 0}>
                                {isZipping ? (
                                    <>
                                        <svg className="spinner" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                             <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                             <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Zipping...
                                    </>
                                ) : (
                                    <>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 15V18C21 19.1046 20.1046 20 19 20H5C3.89543 20 3 19.1046 3 18V15M17 10L12 15M12 15L7 10M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                        Download All as ZIP
                                    </>
                                )}
                            </button> {/* --- Closing tag --- */}
                        </div>
                    </div> // Closing div for results-area
                )}

                <footer> {/* Footer section */}
                Build With ❤️ From Saptrishi Free To Use As Much You Want | © {new Date().getFullYear()}        
                 </footer>
            </div> {/* Closing div for converter-card */}
        </main> // Closing tag for main
    ); // Closing parenthesis for return
} // Closing brace for component function