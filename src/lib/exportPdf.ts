/**
 * Client-side PDF download of the engraved sheet.
 *
 * The rendered abcjs SVG (which already contains the title and tempo) is
 * rasterised onto a canvas at high resolution, then placed on A4 pages with
 * jsPDF. Long sheets paginate by slicing the canvas.
 */

import { jsPDF } from 'jspdf';

const PAGE_W_MM = 210;
const PAGE_H_MM = 297;
const MARGIN_MM = 16;
const RASTER_SCALE = 4; // ≈ 380 dpi at full page width

function svgToImage(svg: SVGSVGElement): Promise<{ img: HTMLImageElement; w: number; h: number }> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const vb = svg.viewBox.baseVal;
  const w = vb && vb.width ? vb.width : svg.clientWidth;
  const h = vb && vb.height ? vb.height : svg.clientHeight;
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  const img = new Image();
  return new Promise((resolve, reject) => {
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ img, w, h });
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function safeFilename(title: string): string {
  const cleaned = title.replace(/[^\w\- ]+/g, '').trim();
  return (cleaned || 'groove') + '.pdf';
}

/**
 * Render the sheet inside `container` to a downloaded PDF.
 * Single-measure grooves are printed narrower and centred so a lone bar
 * comes out large but not stretched wall-to-wall.
 */
export async function exportPdf(container: HTMLElement, title: string): Promise<void> {
  const svg = container.querySelector('svg');
  if (!svg) return;
  const { img, w, h } = await svgToImage(svg as SVGSVGElement);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * RASTER_SCALE);
  canvas.height = Math.round(h * RASTER_SCALE);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const single = container.classList.contains('single-measure');
  const contentW = PAGE_W_MM - MARGIN_MM * 2;
  const imgWmm = single ? contentW * 0.72 : contentW;
  const x = (PAGE_W_MM - imgWmm) / 2;
  const contentH = PAGE_H_MM - MARGIN_MM * 2;
  const imgHmm = (h / w) * imgWmm;

  if (imgHmm <= contentH) {
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', x, MARGIN_MM, imgWmm, imgHmm);
  } else {
    // paginate: slice the canvas into page-height strips
    const pagePx = Math.floor((contentH / imgWmm) * canvas.width);
    let y = 0;
    let first = true;
    while (y < canvas.height) {
      const sliceH = Math.min(pagePx, canvas.height - y);
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = sliceH;
      const sctx = slice.getContext('2d')!;
      sctx.fillStyle = 'white';
      sctx.fillRect(0, 0, slice.width, slice.height);
      sctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      if (!first) pdf.addPage();
      pdf.addImage(
        slice.toDataURL('image/png'),
        'PNG',
        x,
        MARGIN_MM,
        imgWmm,
        (sliceH / canvas.width) * imgWmm,
      );
      first = false;
      y += sliceH;
    }
  }

  pdf.save(safeFilename(title));
}
