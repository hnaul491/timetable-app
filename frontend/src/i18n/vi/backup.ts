import type { Messages } from "../types";

export const backup: Messages["backup"] = {
  title: "Sao lưu",
  help: "Ghi chú và công việc của bạn chỉ được lưu trong ứng dụng này. Mỗi tuần một bản sao được lưu vào Google Drive của bạn (giữ 8 bản gần nhất).",
  download: "Tải bản sao lưu (.json)",
  downloading: "Đang chuẩn bị…",
  downloaded: "Đã tải bản sao lưu",
  downloadFailed: "Không tải được bản sao lưu: {error}",
  drive: "Sao lưu lên Google Drive ngay",
  driving: "Đang sao lưu…",
  driveDone: "Đã lưu bản sao lưu lên Google Drive với tên {name}",
  driveFailed: "Không sao lưu được lên Google Drive: {error}",
  needDrive: "Hãy kết nối Google có quyền Drive (thẻ Google phía trên) để sao lưu lên Drive.",
  lastAt: "Sao lưu Drive gần nhất: {date}",
  never: "Sao lưu Drive gần nhất: chưa có",
  statusFailed: "Không tải được trạng thái sao lưu: {error}",
};
