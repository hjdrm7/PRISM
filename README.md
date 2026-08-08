# PRISM
[![Ask DeepWiki](https://devin.ai/assets/askdeepwiki.png)](https://deepwiki.com/hjdrm7/PRISM)

PRISM is a cross-platform desktop application for batch-enhancing event photos and applying consistent watermarks. Built with Electron and React, it leverages the power of the `sharp` library for high-speed, multi-threaded image processing.

The interface is organized into three main panels. On the left, an image queue allows you to load images from a folder or add them individually via drag-and-drop. The center panel features an interactive before-and-after comparison slider, providing a real-time preview of your enhancements and watermarks. All settings for enhancement, watermarking, and output are located in the right-hand panel.

## Features

-   **Batch Processing:**
    -   Process an entire folder of images or a custom queue of individual files.
    -   Multi-threaded processing utilizes multiple CPU cores for high-speed performance.
    -   View real-time progress with a status bar and per-file updates.
    -   Ability to cancel an ongoing batch job.

-   **Auto-Enhancement:**
    -   A single "Enhancement Intensity" slider controls a sophisticated image processing pipeline designed to make photos pop.
    -   The pipeline applies:
        1.  **Normalization:** Auto-levels stretch for improved white balance and dynamic range.
        2.  **CLAHE:** Contrast Limited Adaptive Histogram Equalization for enhanced local contrast.
        3.  **Median Filter:** Light noise reduction.
        4.  **Saturation Boost:** Increases color vibrancy.
        5.  **Sharpening:** A final unsharp mask to add crispness.

-   **Advanced Watermarking:**
    -   Apply up to 5 PNG watermarks simultaneously.
    -   Customize watermark position (all four corners), size, and opacity.
    -   Add professional effects like a black drop shadow or a white outline.
    -   Fine-tune shadow angle, distance, and outline thickness.

-   **Flexible Output:**
    -   Save images in their original format, or convert to high-quality JPEG or PNG.
    -   Option to add a custom suffix to output filenames (e.g., `photo_edited.jpg`).
    *   Choose how to handle filename conflicts: automatically rename (`image_1.jpg`), overwrite, or skip existing files.

-   **Intuitive UI:**
    -   Sleek dark mode interface.
    -   Interactive preview slider to compare the original and processed image instantly.
    -   Drag-and-drop support for both folders and individual images.
    -   All settings are automatically saved and reloaded between sessions.

## Getting Started

You can download the latest version for your operating system (Windows, macOS, or Linux) from the [**Releases**](https://github.com/hjdrm7/prism/releases) page.

1.  **Load Images:** Choose between 'Folder' mode to process all images in a directory, or 'Image' mode to build a queue of individual files. You can click to browse or drag-and-drop your files/folders onto the application.
2.  **Adjust Settings:** Use the right-hand panel to configure enhancement intensity, add and style watermarks, and set your output preferences.
3.  **Preview:** Click on an image in the queue to see a live preview with a draggable before/after slider.
4.  **Process:** Once you're happy with the settings, click 'Start Processing'.

## Development

To run PRISM locally for development or contributions:

**Prerequisites:**
*   Node.js and npm

**Steps:**
1.  Clone the repository:
    ```bash
    git clone https://github.com/hjdrm7/PRISM.git
    cd PRISM
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Run in development mode:
    ```bash
    npm run dev
    ```
    This will launch the app with hot-reloading and open browser developer tools.

4.  Build for production:
    ```bash
    npm run build
    ```
    This will create a packaged, distributable application in a new `dist` directory.

## Technology Stack

-   **Framework:** [Electron](https://www.electronjs.org/)
-   **UI:** [React](https://reactjs.org/), [Vite](https://vitejs.dev/), [Tailwind CSS](https://tailwindcss.com/)
-   **Image Processing:** [Sharp](https://sharp.pixelplumbing.com/)
