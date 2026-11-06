# Quản lý kho React + Supabase

## Cấu hình online
1. Sao chép `.env.example` thành `.env`.
2. Điền `VITE_SUPABASE_URL` và `VITE_SUPABASE_PUBLISHABLE_KEY`. Dùng Publishable key, tuyệt đối không dùng Secret/service_role key ở frontend.
3. Cài và chạy: `npm install` rồi `npm run dev`.
4. Build triển khai Vercel: Framework Vite, Build Command `npm run build`, Output Directory `dist`. Thêm hai Environment Variables như trong `.env`.

Ứng dụng lưu mỗi nhóm dữ liệu vào cột `data` của dòng `id = shared` trong các bảng `inventory_items`, `inventory_surplus`, `inventory_movements`, và kiểm tra dữ liệu mới khoảng mỗi 5 giây. Cấu hình SQL cần các bảng và chính sách RLS đã tạo.

**Cảnh báo bảo mật:** Cấu hình không cần đăng nhập và cho phép vai trò `anon` đọc/ghi có nghĩa là bất kỳ ai biết Project URL và publishable key đều có thể truy cập dữ liệu qua API. Không dùng cho dữ liệu nhạy cảm hoặc kho cần bảo mật. Bản đồng bộ toàn bộ danh sách phù hợp dùng thử/nhóm nhỏ; các thao tác đồng thời có thể ghi đè cập nhật của nhau.
