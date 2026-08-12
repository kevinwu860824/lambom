const KM_MATRIX_BASE_URL = "https://kmmatrix.fremont.lamrc.net/Search";

export function kmMatrixUrl(partNo: string): string {
  return `${KM_MATRIX_BASE_URL}?q=${encodeURIComponent(partNo)}`;
}

export function openKmMatrix(partNo: string): void {
  window.open(kmMatrixUrl(partNo), "_blank", "noopener,noreferrer");
}
