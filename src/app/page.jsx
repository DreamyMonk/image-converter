"use client";

import React, { useState, useRef, useEffect } from "react";
import Swal from "sweetalert2";
import JSZip from "jszip"; // For client-side ZIP creation
import { saveAs } from "file-saver"; // For client-side file saving
import imageCompression from "browser-image-compression"; // For client-side image conversion

// --- Constants ---
const MAX_FILE_SIZE_MB = 100; // Max file size for client-side validation (mainly for user feedback)
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
// Pixel limit check (important for client-side performance/memory)
const MAX_IMAGE_PIXELS = 2_000_000_000; // 2 Billion pixels - adjust if needed for browser stability
// Define supported output formats for browser-image-compression
const SUPPORTED_OUTPUT_FORMATS = ["webp", "jpeg", "png", "gif"];

// --- Helper Function: Format Bytes ---
const formatBytes = (bytes, decimals = 2) => {
  if (!+bytes) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const index = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, index)).toFixed(dm))} ${
    sizes[index]
  }`;
};

// --- Helper Function: Get Image Dimensions (Client-side) ---
const getImageDimensions = (file) => {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      return reject(new Error("Not an image file."));
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = (err) => {
        reject(new Error("Could not load image data."));
      };
      img.src = e.target.result; // Use result from FileReader
    };
    reader.onerror = (err) => {
      reject(new Error("Could not read file."));
    };
    reader.readAsDataURL(file); // Read file to get Data URL for Image object
  });
};

// --- Main React Component ---
export default function PngConverterPage() {
  // --- State Variables ---
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [outputFormat, setOutputFormat] = useState("webp");
  const [convertedFilesData, setConvertedFilesData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isZipping, setIsZipping] = useState(false);

  // --- Refs ---
  const fileInputRef = useRef(null);
  // Ref for latest selected files (optional, kept for potential future use or complex scenarios)
  const latestSelectedFilesRef = useRef(selectedFiles);

  // --- Effect Hook ---
  // Keep the ref synchronized with the selectedFiles state
  useEffect(() => {
    latestSelectedFilesRef.current = selectedFiles;
  }, [selectedFiles]);

  // --- Event Handlers ---

  // Handles new file selections, appends unique files, performs client-side validation
  // *** FIXED: Added async keyword ***
  const handleFileChange = async (event) => {
    setConvertedFilesData([]); // Clear previous results
    const newlySelectedRawFiles = Array.from(event.target.files || []);
    const currentFileIds = new Set(
      selectedFiles.map((f) => `${f.name}-${f.size}-${f.lastModified}`)
    );

    let filesToAdd = [];
    let errors = [];
    let processingPromises = []; // Store promises for dimension checks

    newlySelectedRawFiles.forEach((file) => {
      // *** FIXED: Use 'file' variable instead of 'f' ***
      const fileId = `${file.name}-${file.size}-${file.lastModified}`;

      // --- Initial Synchronous Checks ---
      if (currentFileIds.has(fileId)) {
        return;
      } // Skip duplicate
      if (!file.type.startsWith("image/")) {
        errors.push(`"${file.name}" (ignored): Not an image.`);
        return;
      } // Skip non-images
      if (file.size > MAX_FILE_SIZE_BYTES) {
        errors.push(
          `"${file.name}" (${formatBytes(
            file.size
          )}) (ignored): Exceeds ${MAX_FILE_SIZE_MB} MB limit.`
        );
        return;
      } // Skip large files

      // --- Asynchronous Dimension Check ---
      const dimensionPromise = getImageDimensions(file)
        .then((dimensions) => {
          const pixelCount = dimensions.width * dimensions.height;
          if (MAX_IMAGE_PIXELS && pixelCount > MAX_IMAGE_PIXELS) {
            errors.push(
              `"${file.name}" (${dimensions.width}x${
                dimensions.height
              }) (ignored): Exceeds dimension limit (${(
                MAX_IMAGE_PIXELS / 1_000_000
              ).toFixed(0)}M pixels).`
            );
          } else {
            filesToAdd.push(file); // Mark file to be added
          }
        })
        .catch((err) => {
          errors.push(
            `"${file.name}" (ignored): Error getting dimensions - ${err.message}`
          );
        });
      processingPromises.push(dimensionPromise);
    });

    // Wait for all asynchronous dimension checks to complete
    // *** FIX: 'await' is now allowed because the function is 'async' ***
    await Promise.allSettled(processingPromises);

    // --- Update State ---
    if (filesToAdd.length > 0) {
      setSelectedFiles((prevFiles) => {
        const existingIds = new Set(
          prevFiles.map((f) => `${f.name}-${f.size}-${f.lastModified}`)
        );
        const trulyNewFiles = filesToAdd.filter(
          (newFile) =>
            !existingIds.has(
              `${newFile.name}-${newFile.size}-${newFile.lastModified}`
            )
        );
        return [...prevFiles, ...trulyNewFiles];
      });
    }

    // --- Show Validation Errors ---
    if (errors.length > 0) {
      Swal.fire({
        icon: "warning",
        title: "Some files were ignored during selection",
        html: errors.join("<br>"),
        customClass: { popup: "swal2-popup" },
      });
    }

    // Clear the visible file input field after processing
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }; // --- End handleFileChange ---

  // Removes a single file from the selectedFiles list
  const handleDeselectFile = (indexToRemove) => {
    setSelectedFiles((prevFiles) =>
      prevFiles.filter((_, index) => index !== indexToRemove)
    );
    setConvertedFilesData([]);
  };

  // Clears all selected files
  const handleClearAll = () => {
    setSelectedFiles([]);
    setConvertedFilesData([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Updates the target output format state
  const handleFormatChange = (event) => {
    setOutputFormat(event.target.value);
    setConvertedFilesData([]);
  };

  // Handles the main "Convert" button click (Client-Side Conversion)
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (selectedFiles.length === 0) {
      Swal.fire({
        icon: "warning",
        title: "No files selected",
        text: "Please select one or more image files.",
        customClass: { popup: "swal2-popup" },
      });
      return;
    }

    setIsLoading(true);
    setConvertedFilesData([]);
    const results = [];
    const errors = [];

    const options = {
      useWebWorker: true,
      initialQuality: 0.8,
      mimeType: `image/${outputFormat === "jpeg" ? "jpg" : outputFormat}`,
      // Add other browser-image-compression options if needed
    };

    Swal.fire({
      title: "Converting Files...",
      html: `Processing ${selectedFiles.length} image(s)...`,
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
      customClass: { popup: "swal2-popup" },
    });

    for (const file of selectedFiles) {
      try {
        const compressedFileBlob = await imageCompression(file, options);
        const baseName =
          file.name.substring(0, file.name.lastIndexOf(".")) || file.name;
        const outputExtension = outputFormat === "jpeg" ? "jpg" : outputFormat;
        const outputFilename = `${baseName}.${outputExtension}`;
        results.push({
          outputName: outputFilename,
          blob: compressedFileBlob,
          success: true,
          originalName: file.name,
        });
      } catch (error) {
        console.error(`Error converting file ${file.name}:`, error);
        errors.push({
          originalName: file.name,
          error: error.message || "Conversion failed.",
          success: false,
        });
      }
    }

    setIsLoading(false);
    setConvertedFilesData(results);
    Swal.close();

    // Show summary notification
    if (errors.length > 0 && results.length > 0) {
      const errorHtml = errors
        .map((err) => `<b>${err.originalName}:</b> ${err.error}`)
        .join("<br>");
      Swal.fire({
        icon: "warning",
        title: "Completed with Issues",
        html: `Successfully converted ${results.length} file(s).<br><br><b>Errors:</b><br>${errorHtml}`,
        customClass: { popup: "swal2-popup" },
      });
    } else if (errors.length > 0) {
      const errorHtml = errors
        .map((err) => `<b>${err.originalName}:</b> ${err.error}`)
        .join("<br>");
      Swal.fire({
        icon: "error",
        title: "Conversion Failed",
        html: errorHtml,
        customClass: { popup: "swal2-popup" },
      });
    } else if (results.length > 0) {
      Swal.fire({
        icon: "success",
        title: "Conversion Complete!",
        text: `${
          results.length
        } file(s) processed to ${outputFormat.toUpperCase()}.`,
        customClass: { popup: "swal2-popup" },
      });
    } else {
      Swal.fire({
        icon: "info",
        title: "No files converted",
        text: "No files were successfully processed.",
        customClass: { popup: "swal2-popup" },
      });
    }
  };

  // Handles download for a single file
  const handleDownload = (blob, filename) => {
    try {
      saveAs(blob, filename);
    } catch (error) {
      console.error("Download failed:", error);
      Swal.fire({
        icon: "error",
        title: "Download Failed",
        text: "Could not initiate file download.",
        customClass: { popup: "swal2-popup" },
      });
    }
  };

  // Handles creating and downloading all converted files as a ZIP
  const handleDownloadAll = async () => {
    if (convertedFilesData.length === 0) {
      /* ... no files alert ... */ return;
    }
    setIsZipping(true);
    Swal.fire({
      title: "Creating ZIP...",
      html: `Preparing ${convertedFilesData.length} file(s)... <span class="zip-progress"><b>0%</b></span>`,
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
      customClass: { popup: "swal2-popup" },
    });
    try {
      const zip = new JSZip();
      convertedFilesData.forEach((fileData) => {
        if (fileData.blob && fileData.outputName) {
          zip.file(fileData.outputName, fileData.blob);
        }
      });
      const zipBlob = await zip.generateAsync(
        {
          type: "blob",
          compression: "DEFLATE",
          compressionOptions: { level: 6 },
        },
        (metadata) => {
          // Progress callback
          const progress = metadata.percent.toFixed(0);
          const popup = Swal.getHtmlContainer();
          if (popup) {
            const progressElement = popup.querySelector(".zip-progress b");
            if (progressElement) progressElement.textContent = `${progress}%`;
            if (metadata.currentFile) {
              Swal.update({
                html: `Compressing: ${metadata.currentFile}...<br>Overall: <span class="zip-progress"><b>${progress}%</b></span>`,
              });
            } else {
              Swal.update({
                html: `Generating ZIP structure... <span class="zip-progress"><b>${progress}%</b></span>`,
              });
            }
          }
        }
      );
      saveAs(zipBlob, `converted_images_${outputFormat}.zip`);
      Swal.close();
    } catch (error) {
      console.error("Error creating ZIP file:", error);
      Swal.fire({
        icon: "error",
        title: "ZIP Creation Failed",
        text: error.message || "Could not create ZIP.",
        customClass: { popup: "swal2-popup" },
      });
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
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M13 10V3L4 14H11V21L20 10H13Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Free Image Converter</span>
          </h1>
          <p className="subtitle">
            I built this because paid converters are annoying 😉
          </p>
          <p className="subtitle">
            Convert multiple images to WebP, JPEG, PNG, GIF, and more{" "}
          </p>
        </header>

        <form onSubmit={handleSubmit}>
          {/* File Input */}
          <div className="form-section">
            <label htmlFor="image_files">1. Select or Drop Image Files:</label>
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
            <p className="help-text">
              Max {MAX_FILE_SIZE_MB} MB per file. Add more files anytime.
            </p>
            <p className="help-text">
              Max {(MAX_IMAGE_PIXELS / 1_000_000).toFixed(0)} Million pixels per
              image.
            </p>
          </div>

          {/* Selected Files List */}
          {selectedFiles.length > 0 && (
            <div className="form-section file-list-container">
              <div className="file-list-header">
                <label>{selectedFiles.length} File(s) Ready:</label>
                <button
                  type="button"
                  className="clear-all-button"
                  onClick={handleClearAll}
                  disabled={isLoading || isZipping}
                >
                  {" "}
                  Clear All{" "}
                </button>
              </div>
              <ul className="file-list">
                {selectedFiles.map((file, index) => (
                  <li key={`${file.name}-${file.lastModified}-${index}`}>
                    <div className="file-details">
                      <span className="file-name" title={file.name}>
                        {file.name}
                      </span>
                      <span className="file-size">
                        {formatBytes(file.size)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="deselect-button"
                      onClick={() => handleDeselectFile(index)}
                      disabled={isLoading || isZipping}
                      aria-label={`Remove ${file.name}`}
                      title={`Remove ${file.name}`}
                    >
                      ×
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
              {SUPPORTED_OUTPUT_FORMATS.map((format) => (
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
                {" "}
                <svg className="spinner" viewBox="0 0 24 24">
                  ...
                </svg>{" "}
                Processing...{" "}
              </>
            ) : (
              <>
                {" "}
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  ...
                </svg>{" "}
                Convert{" "}
                {selectedFiles.length > 0
                  ? `(${selectedFiles.length}) File(s)`
                  : "Files"}{" "}
              </>
            )}
          </button>
        </form>

        {/* Results Area */}
        {convertedFilesData.length > 0 && !isLoading && (
          <div className="results-area">
            <h2>Conversion Results ({outputFormat.toUpperCase()}):</h2>
            {convertedFilesData.map((fileData, index) => (
              <div
                key={`${fileData.outputName}-${index}-result`}
                className="result-item"
              >
                <div className="file-info">
                  <span title={fileData.outputName}>{fileData.outputName}</span>
                  <span className="file-size" style={{ marginLeft: "10px" }}>
                    ({formatBytes(fileData.blob.size)})
                  </span>
                </div>
                <button
                  className="download-button"
                  onClick={() =>
                    handleDownload(fileData.blob, fileData.outputName)
                  }
                  disabled={isZipping}
                  aria-label={`Download ${fileData.outputName}`}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    ...
                  </svg>
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
                disabled={isZipping || convertedFilesData.length === 0}
                aria-label="Download all converted files as a ZIP archive"
              >
                {isZipping ? (
                  <>
                    {" "}
                    <svg className="spinner" viewBox="0 0 24 24">
                      ...
                    </svg>{" "}
                    Zipping...{" "}
                    <span className="zip-progress">
                      <b>0%</b>
                    </span>{" "}
                  </>
                ) : (
                  <>
                    {" "}
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      ...
                    </svg>{" "}
                    Download All ({convertedFilesData.length}) as ZIP{" "}
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        <footer>
          Build With ❤️ From Saptrishi | Free To Use | ©{" "}
          {new Date().getFullYear()}
        </footer>
      </div>
    </main>
  );
}
