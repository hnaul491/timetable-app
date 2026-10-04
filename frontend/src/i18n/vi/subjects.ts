import type { Messages } from "../types";

export const subjects: Messages["subjects"] = {
  loading: "Đang tải môn học…",
  title: "Môn học",
  empty: "Chưa có môn học nào — hãy đồng bộ lịch học của trường trước.",
  hidden: "Đã ẩn",
  summary: {
    one: "{done}/{total} buổi · {count} việc chưa xong",
    other: "{done}/{total} buổi · {count} việc chưa xong",
  },
  summaryNext: {
    one: "{done}/{total} buổi · {count} việc chưa xong · buổi tới {date}",
    other: "{done}/{total} buổi · {count} việc chưa xong · buổi tới {date}",
  },
  exam: "Thi {date}",
  detail: {
    back: "‹ Tất cả môn học",
    alsoCalled: "Còn gọi là: {names}",
    subject: "Môn học",
    stats: "{sessions} buổi · {done} đã học · {notes} ghi chú · {open} việc chưa xong",
    exam: "Thi",
    progress: "Đã học {done}/{total} buổi",
    sessions: "Các buổi học",
    noSessions: "Chưa có buổi học nào (môn đã ẩn, hoặc hãy chọn nhóm của bạn trong Cài đặt).",
    noNotes: "Chưa có ghi chú",
    cancelled: "Đã huỷ",
    changed: "Đã đổi",
    important: "Quan trọng",
    openCount: "{count} chưa xong",
    tasks: "Việc",
    due: "hạn {date}",
    openBoard: "Mở bảng việc",
  },
};
