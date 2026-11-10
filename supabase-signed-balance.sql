-- NANG CAP SO DU BU TRU HAI CHIEU THEO MA HANG
-- Khong xoa bang cu, khong xoa lich su, giu nguyen du lieu da co.

-- Bang nay da duoc tao boi SQL netting truoc do; cac lenh duoi day an toan de chay lai.
create table if not exists public.inventory_issue_balance (
  code text primary key,
  name text not null default '',
  outstanding_shortage numeric not null default 0,
  surplus_credit numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- Them cot so du co dau (+/-).
alter table public.inventory_issue_balance
  add column if not exists balance numeric not null default 0;

-- Chuyen so du cu sang mot so duy nhat:
-- duong = ho no minh; am = minh no ho.
update public.inventory_issue_balance
set balance = coalesce(surplus_credit, 0) - coalesce(outstanding_shortage, 0);

alter table public.inventory_issue_balance enable row level security;
drop policy if exists "Allow anon access inventory issue balance"
  on public.inventory_issue_balance;
create policy "Allow anon access inventory issue balance"
on public.inventory_issue_balance
for all to anon
using (true)
with check (true);
grant select, insert, update, delete
on public.inventory_issue_balance to anon;

-- RPC: moi phieu cap nhat so du bang phep cong co dau.
create or replace function public.apply_inventory_transaction(
  p_code text,
  p_type text,
  p_quantity numeric,
  p_note text default '',
  p_reference_id text default null,
  p_actual_issued numeric default null,
  p_slip_qty numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_item jsonb;
  v_new_items jsonb := '[]'::jsonb;
  v_stock_before numeric;
  v_stock_after numeric;
  v_delta numeric;
  v_name text;
  v_actual numeric;
  v_slip numeric;
  v_difference numeric;
  v_balance_before numeric := 0;
  v_balance_after numeric := 0;
begin
  if coalesce(trim(p_code), '') = '' then
    raise exception 'Mã hàng không được để trống';
  end if;

  if p_type not in (
    'IN', 'OUT', 'ISSUE', 'SURPLUS_RETURN',
    'ADJUST_IN', 'ADJUST_OUT', 'ISSUE_WITH_SURPLUS'
  ) then
    raise exception 'Loại giao dịch không hợp lệ';
  end if;

  if p_type = 'ISSUE_WITH_SURPLUS' then
    v_actual := coalesce(p_actual_issued, 0);
    v_slip := coalesce(p_slip_qty, 0);
    if v_actual < 0 or v_slip < 0 or (v_actual = 0 and v_slip = 0) then
      raise exception 'Số lượng phát thực tế và số lượng trên phiếu phải hợp lệ';
    end if;
  else
    if p_quantity is null or p_quantity <= 0 then
      raise exception 'Số lượng phải lớn hơn 0';
    end if;
  end if;

  -- Khoa dong ton kho de tranh hai giao dich cap nhat cung luc.
  select data into v_items
  from public.inventory_items
  where id = 'shared'
  for update;

  if v_items is null or jsonb_typeof(v_items) <> 'array' then
    raise exception 'Không tìm thấy dữ liệu danh mục hàng hóa';
  end if;

  select x into v_item
  from jsonb_array_elements(v_items) x
  where lower(x->>'code') = lower(trim(p_code))
  limit 1;

  if v_item is null then
    raise exception 'Không tìm thấy mã hàng: %', p_code;
  end if;

  v_name := coalesce(v_item->>'name', '');
  v_stock_before := coalesce(nullif(v_item->>'stock', '')::numeric, 0);

  if p_type = 'ISSUE_WITH_SURPLUS' then
    -- Ton kho tru theo thuc phat, khong tru theo so tren phieu.
    v_delta := -v_actual;
  elsif p_type in ('IN', 'SURPLUS_RETURN', 'ADJUST_IN') then
    v_delta := p_quantity;
  else
    v_delta := -p_quantity;
  end if;

  v_stock_after := v_stock_before + v_delta;
  if v_stock_after < 0 then
    raise exception 'Tồn kho không đủ. Tồn hiện tại: %, cần xuất: %',
      v_stock_before, abs(v_delta);
  end if;

  for v_item in select x from jsonb_array_elements(v_items) x loop
    if lower(v_item->>'code') = lower(trim(p_code)) then
      v_new_items := v_new_items || jsonb_build_array(
        jsonb_set(v_item, '{stock}', to_jsonb(v_stock_after), true)
      );
    else
      v_new_items := v_new_items || jsonb_build_array(v_item);
    end if;
  end loop;

  update public.inventory_items
  set data = v_new_items
  where id = 'shared';

  if p_type = 'ISSUE_WITH_SURPLUS' then
    insert into public.inventory_issue_balance (
      code, name, outstanding_shortage, surplus_credit, balance
    ) values (trim(p_code), v_name, 0, 0, 0)
    on conflict (code) do nothing;

    select balance into v_balance_before
    from public.inventory_issue_balance
    where code = trim(p_code)
    for update;

    -- So du moi = so du cu + (thuc phat - tren phieu).
    -- Duong: ho no minh. Am: minh no ho.
    v_difference := v_actual - v_slip;
    v_balance_after := v_balance_before + v_difference;

    update public.inventory_issue_balance
    set name = v_name,
        balance = v_balance_after,
        surplus_credit = greatest(v_balance_after, 0),
        outstanding_shortage = greatest(-v_balance_after, 0),
        updated_at = now()
    where code = trim(p_code);

    -- Luu tung phieu, khong ghi de lich su cu.
    insert into public.inventory_history (
      code, name, transaction_type, quantity, delta,
      stock_before, stock_after, note, reference_id, details
    ) values (
      trim(p_code), v_name, 'ISSUE_WITH_SURPLUS', v_actual, v_delta,
      v_stock_before, v_stock_after, coalesce(p_note, ''), p_reference_id,
      jsonb_build_object(
        'actual_issued', v_actual,
        'slip_qty', v_slip,
        'difference', v_difference,
        'balance_before', v_balance_before,
        'signed_balance', v_balance_after,
        'balance_direction', case
          when v_balance_after > 0 then 'THEY_OWE_US'
          when v_balance_after < 0 then 'WE_OWE_THEM'
          else 'SETTLED'
        end
      )
    );

    -- Dong lich su rieng cho thay doi so du cong no hang hoa.
    insert into public.inventory_history (
      code, name, transaction_type, quantity, delta,
      stock_before, stock_after, note, reference_id, details
    ) values (
      trim(p_code), v_name, 'ISSUE_BALANCE_CHANGE', abs(v_difference), 0,
      v_stock_after, v_stock_after,
      'Cập nhật số dư bù trừ hai chiều', p_reference_id,
      jsonb_build_object(
        'balance_before', v_balance_before,
        'balance_change', v_difference,
        'signed_balance', v_balance_after
      )
    );

    return jsonb_build_object(
      'success', true,
      'code', trim(p_code),
      'name', v_name,
      'stock_before', v_stock_before,
      'stock_after', v_stock_after,
      'delta', v_delta,
      'difference', v_difference,
      'balance_before', v_balance_before,
      'signed_balance', v_balance_after
    );
  end if;

  insert into public.inventory_history (
    code, name, transaction_type, quantity,
    delta, stock_before, stock_after, note, reference_id
  ) values (
    trim(p_code), v_name, p_type, p_quantity,
    v_delta, v_stock_before, v_stock_after,
    coalesce(p_note, ''), p_reference_id
  );

  return jsonb_build_object(
    'success', true,
    'code', trim(p_code),
    'name', v_name,
    'stock_before', v_stock_before,
    'stock_after', v_stock_after,
    'delta', v_delta
  );
end;
$$;

grant execute on function public.apply_inventory_transaction(
  text, text, numeric, text, text, numeric, numeric
) to anon;

notify pgrst, 'reload schema';
