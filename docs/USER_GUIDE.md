# Scan Sorter: User Guide

Scan Sorter puts shuffled scanned pages back in order. It reads the page numbers printed on
each page, tells you which pages are missing or scanned twice, and gives you a sorted PDF to
download.

Your files stay on your computer. Nothing is uploaded.

---

## What it does

- Takes a pile of scanned PDFs or phone photos of pages, in any order.
- Reads the page numbers printed at the top or bottom of each page.
- Puts the pages in order.
- Warns you about gaps, duplicates, and pages it could not read.
- Lets you fix those problems, and move, rotate or remove pages.
- Saves the result as one sorted PDF.

Just looking? Click **Try it with sample pages** on the start screen to explore a made-up
document with a missing page, a duplicate and a few unclear reads. Downloading is turned off in
that demo; add your own files to try it for real.

---

## Step by step

### 1. Add your files

Drag your PDF files or photos onto the page, or click **Choose files** and pick them. PDF, JPG,
PNG and WebP files work; you can also paste an image with Ctrl+V. You can add more files later
with **Add files**, even while the app is still reading, and they are read next.

### 2. Wait for the reading to finish

Pages appear as thumbnails while Scan Sorter looks at them. A progress bar shows how many pages
have been read. The first time you add a scanned file (one without selectable text), it takes a
few seconds longer, because the text-reading engine has to load. While it reads a shuffled
document, the order and the warnings may shift around; wait until the progress bar finishes.

If it takes too long, press **Cancel**. Everything read so far stays on screen; pages that were
not read show a "?" badge and you can set their numbers by hand, add more files, or **Start over**.

### 3. Check the summary

When reading finishes, the summary panel (on the right on a computer, above the pages on a
phone, where you tap its header to open it) says either "All 16 pages in order" or what needs a
look, for example "1 page missing · 1 duplicate · 2 unnumbered". Each row in the panel is
clickable and jumps to the page it is about. See "What the warnings mean" below.

### 4. Fix or reorder

Every page card shows a badge with the number that was read, such as "p. 12", or "?" when no
number was found. Green means confident, amber means please check, red means a problem.

- **Wrong number?** Click the badge (or the pencil) and type the right number in the
  **Page number** dialog. Use `iv`-style letters for front-matter pages with roman numerals. If
  the app has a guess, it offers it as a chip you can click. **This page has no number** marks
  the page as unnumbered; **Reset to automatic** goes back to what the app read.
- **Wrong place?** Drag the page by its handle (the dotted grip) to where it belongs. With a
  keyboard: focus the grip, press Space, move with the arrow keys, press Space again. Once you
  have moved pages by hand, the order stays as you set it, the "Page 17 missing" tiles are
  hidden, and a note says "Order set by hand". **Back to automatic order** returns to the order
  Scan Sorter worked out.
- **Wrong way up?** Click the rotate button on the card. Each click turns the page a quarter
  turn; the download gets the same rotation.
- **Not part of the document?** Click the bin on the card to remove the page. It is left out of
  the download but not deleted from your files.
- **Want a closer look?** Click the thumbnail to open a large preview. Use the arrow keys or the
  side arrows to move between pages, and rotate, edit or remove from there. Esc closes it.

Every change can be undone with **Undo** (and redone with **Redo**) in the toolbar. Removing
pages also shows an Undo button in the message at the bottom of the screen.

### 5. Download

When you are happy with the order, press **Download sorted PDF**. You get one PDF with the
pages in order, named after your first file with `-sorted` added. If pages are still missing or
two pages claim the same number, the app asks **Download anyway?** first; missing pages are
simply left out of the PDF. Your original files are not changed.

**Start over** clears everything from the screen (after asking) so you can begin with another
document.

---

## What the warnings mean

### Missing

Example: "Page 17 is missing." Scan Sorter found pages 16 and 18, but nothing numbered 17.
A dashed "Page 17 missing" tile sits in the grid where the page belongs.

What to do: check your stack or your scanner output for page 17. If you find it, add that file
with **Add files**. If the page really is not part of the document, you can ignore the warning
and download anyway.

### Duplicates

Example: "Page 9 was scanned twice." Two pages look the same and carry the same number.

What to do: click **Remove extra** on that row, or **Remove duplicate scans** at the top of the
section to remove all extra copies at once. Undo brings them back.

Example: "2 different pages all read as 20. Please check." Two pages carry the same number but
look different. Usually one of the numbers was misread, or a chapter opener has a similar number
to a page. Click the row to see both pages, correct the number on the wrong one, and the warning
goes away.

### No page number

Scan Sorter could not find a page number on that page, and the card shows "?". This happens
with title pages, blank pages, pages that have no printed number, or pages where the number is
cut off or very faint.

What to do: click **Set number** and type the number if you know it. If the page really has no
number, leave it; it stays next to the page it followed in your original pile.

### Please confirm

A page is numbered, but Scan Sorter is not fully sure of the number, for example "p. 5 (57%
sure)". Look at the page: if the number is right, click **Looks right**; otherwise click
**Change** and type the correct one.

### Notes

Plain information rather than warnings, for example "Numbering starts at 37" for an excerpt, or
the total detected from "Page 3 of 10" footers.

### Problems while reading your files

If a file could not be opened (for example a password-protected PDF or a file that is not really
a PDF) or a page could not be rendered, a yellow note appears above the pages with the details.
Everything else is kept.

---

## Tips for the best results

- **Scan straight.** Crooked pages are harder to read. Keep the page flat and square to the
  scanner or camera.
- **Include the page-number area.** Page numbers are usually at the top or bottom of the
  page. Make sure they are in the scan, not cut off at the edge.
- **Use good light when photographing.** Avoid shadows across the page and glare from shiny
  paper. Photograph from directly above. Photos taken sideways are turned upright automatically.
- **Scan at 200 to 300 DPI.** This is the usual setting on scanners. Higher settings make larger
  files without making the page numbers easier to read.
- **Keep the pages in one piece.** Pages that are folded, torn, or stuck together can be hard to
  read.

---

## Privacy

Scan Sorter works entirely in your web browser. Your documents are opened, read, sorted, and
saved on your own computer. They are never sent over the internet. The app does not save your
documents anywhere for later; closing the tab clears them. The only thing it keeps on your
computer is the English text-reading data (and your light/dark theme choice), which the browser
stores so the app loads faster next time.

---

## Frequently asked questions

**Can I use photos taken with my phone?**
Yes. Add the photos directly. Each photo becomes one page, fitted onto an A4 sheet in the PDF.
For best results, follow the tips above.

**Can I add several files at once?**
Yes. You can drop in several PDFs and photos together, and you can add more files later. Scan
Sorter looks at all the pages together, so a page from one file can fill a gap in another.

**Why is a page marked "?"?**
Scan Sorter could not read a page number on that page with enough confidence. Click the badge
and type the number, or leave it if the page has no number.

**Does it work offline?**
Once the app has loaded, it is designed to work without an internet connection. The first
time you use it, open it while you are online so that everything it needs can be saved on your
computer.

**Is there a page limit?**
There is no fixed page limit. The app is designed to handle a few hundred pages, but very large
documents take longer to read and need more memory from your computer. If your browser slows
down, try working with smaller batches of files.

**Will my original files change?**
No. The sorted PDF is a new file. Your original scans stay exactly as they were.

**Which languages can it read?**
Page numbers are read using English text recognition. Page numbers written in Arabic numerals
(1, 2, 3) and in Roman numerals (i, ii, iii) are supported. Words such as "Page" are recognised
in a few other languages, but the text recognition itself is English.

**Can it fix pages that are upside down or sideways?**
You can rotate a page yourself with the rotate button on the card or in the large preview. The
app does not yet detect sideways scans automatically (photos with orientation information are
turned upright, though).

**Can I switch to a dark theme?**
Yes. The button at the top right cycles between automatic (follows your system), light and dark.
