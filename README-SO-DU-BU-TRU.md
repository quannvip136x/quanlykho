# Nâng cấp số dư bù trừ hai chiều

## Quy tắc
- Số dư dương (+): bên nhận còn nợ kho.
- Số dư âm (-): kho còn nợ bên nhận.
- Số dư 0: hai bên cân bằng.
- Số dư mới = số dư cũ + (số lượng phát thực tế - số lượng trên phiếu).
- Tồn kho chỉ giảm theo số lượng phát thực tế.

## Cập nhật Supabase
1. Giữ nguyên các SQL cũ và dữ liệu hiện tại.
2. Mở Supabase > SQL Editor > New query.
3. Chạy toàn bộ file `supabase-signed-balance.sql`.
4. Không xóa bảng hoặc lịch sử cũ.

## Chạy local
1. Giải nén dự án.
2. Tạo/giữ file `.env` trong thư mục dự án với:
   - `VITE_SUPABASE_URL=https://<project-ref>.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key-cua-dung-project>`
3. Chạy `npm install` rồi `npm run dev`.

Không đưa secret/service_role key vào ứng dụng frontend.
