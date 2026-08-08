# 🔮 PRISM (Photo Rendering, Image Styling & Marking)

PRISM was developed for the **officers and members of ACCESS at USTP Oroquieta**. 🎓📸

It is a cross-platform desktop application for **batch-enhancing event photos and applying consistent watermarks**. Built with **Electron** and **React**, PRISM uses the **Sharp** image-processing library for fast, multi-threaded processing, making it easier to prepare large batches of event photos efficiently. ⚡🖼️

The interface is organized into **three main panels**:

* 📂 **Left — Image Queue:** Load images from a folder or add individual files through drag-and-drop.
* 🔄 **Center — Preview:** Use the interactive before-and-after comparison slider to preview your enhancements and watermarks in real time.
* ⚙️ **Right — Settings:** Configure enhancement, watermarking, and output options.

## ✨ Features

### 📦 Batch Processing

* 📁 Process an entire folder of images or build a custom queue of individual files.
* 🚀 Multi-threaded processing utilizes multiple CPU cores for high-speed performance.
* 📊 View real-time progress with a status bar and per-file updates.
* 🛑 Cancel an ongoing batch job whenever needed.

### 🎨 Auto-Enhancement

A single **Enhancement Intensity** slider controls a sophisticated image-processing pipeline designed to make photos pop. ✨

The pipeline applies:

1. 🌈 **Normalization** — Auto-levels stretch for improved white balance and dynamic range.
2. 🌓 **CLAHE** — Contrast Limited Adaptive Histogram Equalization for enhanced local contrast.
3. 🧹 **Median Filter** — Light noise reduction.
4. 🌈 **Saturation Boost** — Increases color vibrancy.
5. 🔍 **Sharpening** — A final unsharp mask to add crispness.

### 💧 Advanced Watermarking

* 🖼️ Apply up to **5 PNG watermarks** simultaneously.
* 📍 Customize watermark position across all four corners.
* 📏 Adjust watermark size and opacity.
* 🌑 Add a professional black drop shadow.
* ⚪ Add a white outline for improved visibility.
* 🎛️ Fine-tune shadow angle, distance, and outline thickness.

### 💾 Flexible Output

* 📸 Save images in their original format or convert them to high-quality **JPEG** or **PNG**.
* ✏️ Add a custom suffix to output filenames, such as `photo_edited.jpg`.
* 🔄 Choose how to handle filename conflicts:

  * Automatically rename (`image_1.jpg`)
  * Overwrite existing files
  * Skip existing files

### 🖥️ Intuitive UI

* 🌙 Sleek dark-mode interface.
* ↔️ Interactive before-and-after slider for instant comparisons.
* 🖱️ Drag-and-drop support for both folders and individual images.
* 💾 Settings are automatically saved and restored between sessions.

## 🚀 Getting Started

You can download the latest version for **Windows, macOS, or Linux** from the [**Releases**](https://github.com/hjdrm7/prism/releases) page. 📥

### 1. 📂 Load Images

Choose between **Folder** mode to process all images in a directory or **Image** mode to build a queue of individual files.

You can click to browse or drag-and-drop your files or folders directly into the application.

### 2. ⚙️ Adjust Settings

Use the right-hand panel to configure:

* 🎨 Enhancement intensity
* 💧 Watermarks and their styling
* 📤 Output format and filename options

### 3. 👀 Preview

Click on an image in the queue to see a live preview with a **draggable before/after slider**.

### 4. ⚡ Process

Once you're happy with the settings, click **Start Processing** and let PRISM handle the rest. 🚀

## 🛠️ Development

To run PRISM locally for development or contributions:

### 📋 Prerequisites

* 🟢 Node.js
* 📦 npm

### 1. 📥 Clone the Repository

```bash
git clone https://github.com/hjdrm7/PRISM.git
cd PRISM
```

### 2. 📦 Install Dependencies

```bash
npm install
```

### 3. 💻 Run in Development Mode

```bash
npm run dev
```

This will launch the app with hot-reloading and open the browser developer tools. 🔧

### 4. 📦 Build for Production

```bash
npm run build
```

This will create a packaged, distributable application in a new `dist` directory. 🚀

## 🧰 Technology Stack

* 🖥️ **Framework:** [Electron](https://www.electronjs.org/)
* ⚛️ **UI:** [React](https://react.dev/), [Vite](https://vitejs.dev/), [Tailwind CSS](https://tailwindcss.com/)
* 🖼️ **Image Processing:** [Sharp](https://sharp.pixelplumbing.com/)

---

📸 **Built for ACCESS at USTP Oroquieta — making event photo processing faster, easier, and more consistent.**
