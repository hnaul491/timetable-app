import type { Messages } from "../types";

export const board: Messages["board"] = {
  loading: "Đang tải danh sách việc…",
  title: "Bảng việc",
  openSummary: "{count} việc chưa xong · việc được lấy từ các dòng [ ] trong ghi chú buổi học",
  subject: "Môn học",
  allSubjects: "Tất cả môn học",
  newTask: "Việc mới",
  newTaskPlaceholder: "vd. In phiếu thực hành",
  due: "Hạn",
  addTask: "Thêm việc",
  todo: "Cần làm",
  doing: "Đang làm",
  done: "Xong",
  card: {
    important: "Quan trọng",
    due: "Hạn {date}",
    noDueDate: "Không có hạn",
    fromClass: "Từ buổi học",
    statusFor: "Trạng thái của {title}",
    deleteAria: "Xoá {title}",
    confirmDeleteAria: "Bấm lần nữa để xoá {title}",
    confirmDelete: "Bấm lần nữa để xoá",
  },
};
