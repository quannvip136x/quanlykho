# Cài đặt và chạy ứng dụng quản lý kho

## 1. Cấu hình Supabase

Tạo file `.env` ở thư mục gốc (cùng cấp `package.json`) với nội dung:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

Dùng URL và Publishable key thuộc cùng một dự án Supabase. Không dùng `service_role` key trong ứng dụng React.

Ứng dụng sử dụng các bảng/cấu trúc đã có trong dự án:
- `inventory_items`: dữ liệu danh mục được lưu ở dòng `id = 'shared'`, cột `data` JSON.
- `inventory_surplus`: dữ liệu phiếu hàng dư được lưu ở dòng `id = 'shared'`, cột `data` JSON.
- `inventory_history`: lịch sử giao dịch kho.
- RPC `apply_inventory_transaction`: cập nhật tồn kho và ghi lịch sử trong cùng giao dịch.

## 2. Cài và chạy

```bash
npm.cmd install
npm.cmd run dev
```

## 3. Đưa lên Vercel

Đặt hai biến môi trường `VITE_SUPABASE_URL` và `VITE_SUPABASE_PUBLISHABLE_KEY` trong Vercel, sau đó Deploy lại.

## 4. Chức năng được giữ và bổ sung

Bản này giữ các trang Tổng quan, Danh mục hàng hóa, Theo dõi hàng dư, Lịch sử kho; giữ nhập/xuất Excel, sao lưu/khôi phục, tìm kiếm và quản lý danh mục. Bổ sung thao tác Nhập kho và Xuất kho ở Tổng quan, Danh mục hàng hóa và Lịch sử kho.

- Nhập kho: cộng đúng số lượng nhập vào tồn của mã hàng được chọn.
- Xuất kho: trừ đúng số lượng xuất khỏi tồn của mã hàng được chọn; Supabase từ chối nếu tồn không đủ.
- Mỗi giao dịch được ghi vào `inventory_history` với mã hàng, tên hàng, loại giao dịch, số lượng thay đổi, tồn trước, tồn sau, thời gian và ghi chú.
- Lịch sử được tải từ Supabase và có thể xuất Excel.

Lưu ý: ứng dụng đang dùng quyền truy cập `anon` theo cấu hình không đăng nhập. Publishable key không phải bí mật; mọi người có URL và key có thể thao tác theo quyền RLS đã cấp. Chỉ dùng cho môi trường phù hợp với mức độ rủi ro này.
