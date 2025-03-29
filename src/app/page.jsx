"use client";

import React, { useState, useRef, useEffect } from "react";
import Swal from "sweetalert2";
import JSZip from "jszip"; // For client-side ZIP creation
import { saveAs } from "file-saver"; // For client-side file saving
import imageCompression from "browser-image-compression"; // For client-side image conversion

// --- Constants ---
const MAX_FILE_SIZE_MB = 100;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_IMAGE_PIXELS = 2_000_000_000;
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
      img.src = e.target.result;
    };
    reader.onerror = (err) => {
      reject(new Error("Could not read file."));
    };
    reader.readAsDataURL(file);
  });
};

// --- Main React Component ---
export default function PngConverterPage() {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [outputFormat, setOutputFormat] = useState("webp");
  const [convertedFilesData, setConvertedFilesData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const fileInputRef = useRef(null);
  const latestSelectedFilesRef = useRef(selectedFiles);

  useEffect(() => {
    latestSelectedFilesRef.current = selectedFiles;
  }, [selectedFiles]);

  const handleFileChange = async (event) => {
    setConvertedFilesData([]);
    const newlySelectedRawFiles = Array.from(event.target.files || []);
    const currentFileIds = new Set(
      selectedFiles.map((f) => `${f.name}-${f.size}-${f.lastModified}`)
    );
    let filesToAdd = [];
    let errors = [];
    let processingPromises = [];
    newlySelectedRawFiles.forEach((file) => {
      const fileId = `${file.name}-${file.size}-${file.lastModified}`; // Corrected var name
      if (currentFileIds.has(fileId)) {
        return;
      }
      if (!file.type.startsWith("image/")) {
        errors.push(`"${file.name}" (ignored): Not an image.`);
        return;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        errors.push(
          `"${file.name}" (${formatBytes(
            file.size
          )}) (ignored): Exceeds ${MAX_FILE_SIZE_MB} MB limit.`
        );
        return;
      }
      const dimensionPromise = getImageDimensions(file)
        .then((dimensions) => {
          const pixelCount = dimensions.width * dimensions.height;
          if (MAX_IMAGE_PIXELS && pixelCount > MAX_IMAGE_PIXELS) {
            errors.push(
              `"${file.name}" (${dimensions.width}x${
                dimensions.height
              }) (ignored): Exceeds pixel limit (${(
                MAX_IMAGE_PIXELS / 1_000_000
              ).toFixed(0)}M pixels).`
            );
          } else {
            filesToAdd.push(file);
          }
        })
        .catch((err) => {
          errors.push(
            `"${file.name}" (ignored): Error getting dimensions - ${err.message}`
          );
        });
      processingPromises.push(dimensionPromise);
    });
    await Promise.allSettled(processingPromises);
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
    if (errors.length > 0) {
      Swal.fire({
        icon: "warning",
        title: "Some files ignored",
        html: errors.join("<br>"),
        customClass: { popup: "swal2-popup" },
      });
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDeselectFile = (indexToRemove) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== indexToRemove));
    setConvertedFilesData([]);
  };
  const handleClearAll = () => {
    setSelectedFiles([]);
    setConvertedFilesData([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };
  const handleFormatChange = (event) => {
    setOutputFormat(event.target.value);
    setConvertedFilesData([]);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (selectedFiles.length === 0) {
      Swal.fire({
        icon: "warning",
        title: "No files selected",
        text: "Please select image files.",
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
    if (errors.length > 0 && results.length > 0) {
      const errHtml = errors
        .map((e) => `<b>${e.originalName}:</b> ${e.error}`)
        .join("<br>");
      Swal.fire({
        icon: "warning",
        title: "Completed with Issues",
        html: `Converted ${results.length} file(s).<br><br><b>Errors:</b><br>${errHtml}`,
        customClass: { popup: "swal2-popup" },
      });
    } else if (errors.length > 0) {
      const errHtml = errors
        .map((e) => `<b>${e.originalName}:</b> ${e.error}`)
        .join("<br>");
      Swal.fire({
        icon: "error",
        title: "Conversion Failed",
        html: errHtml,
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
        customClass: { popup: "swal2-popup" },
      });
    }
  };

  const handleDownload = (blob, filename) => {
    try {
      saveAs(blob, filename);
    } catch (e) {
      Swal.fire({
        icon: "error",
        title: "Download Failed",
        customClass: { popup: "swal2-popup" },
      });
    }
  };

  const handleDownloadAll = async () => {
    if (convertedFilesData.length === 0) {
      Swal.fire({
        icon: "info",
        title: "No files to zip",
        customClass: { popup: "swal2-popup" },
      });
      return;
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
      convertedFilesData.forEach((f) => {
        if (f.blob && f.outputName) zip.file(f.outputName, f.blob);
      });
      const zipBlob = await zip.generateAsync(
        {
          type: "blob",
          compression: "DEFLATE",
          compressionOptions: { level: 6 },
        },
        (metadata) => {
          const progress = metadata.percent.toFixed(0);
          const popup = Swal.getHtmlContainer();
          if (popup) {
            const progEl = popup.querySelector(".zip-progress b");
            if (progEl) progEl.textContent = `${progress}%`;
            const baseHtml = metadata.currentFile
              ? `Compressing: ${metadata.currentFile}...`
              : `Generating ZIP structure...`;
            Swal.update({
              html: `${baseHtml}<br>Overall: <span class="zip-progress"><b>${progress}%</b></span>`,
            });
          }
        }
      );
      saveAs(zipBlob, `converted_images_${outputFormat}.zip`);
      Swal.close();
    } catch (error) {
      Swal.fire({
        icon: "error",
        title: "ZIP Failed",
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
            {/* Lightning Bolt Icon */}
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
                {/* Spinner Icon */}
                <svg
                  className="spinner"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    style={{ opacity: 0.25 }}
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    style={{ opacity: 0.75 }}
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                Processing...
              </>
            ) : (
              <>
                {/* Arrow Icon */}
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M14 5L21 12M21 12L14 19M21 12H3"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Convert{" "}
                {selectedFiles.length > 0
                  ? `(${selectedFiles.length}) File(s)`
                  : "Files"}
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
                  {/* Download Icon */}
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M4 15L4 18C4 19.1046 4.89543 20 6 20L18 20C19.1046 20 20 19.1046 20 18V15M12 4L12 15M12 15L8 11M12 15L16 11"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
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
                    {/* Spinner Icon */}
                    <svg
                      className="spinner"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        style={{ opacity: 0.25 }}
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        style={{ opacity: 0.75 }}
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Zipping...{" "}
                    <span className="zip-progress">
                      <b>0%</b>
                    </span>
                  </>
                ) : (
                  <>
                    {/* Download All Icon */}
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M21 15V18C21 19.1046 20.1046 20 19 20H5C3.89543 20 3 19.1046 3 18V15M17 10L12 15M12 15L7 10M12 15V3"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Download All ({convertedFilesData.length}) as ZIP
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
