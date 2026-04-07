"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type SessionRow = {
  id: string;
  session_number: string;
  guest_count: number;
  order_status: string;
  payment_status: string;
  total_amount: number;
  customer_type?: string | null;
  customer_label?: string | null;
  created_at?: string | null;
};

type SessionSeatRow = {
  session_id: string;
  seats: { seat_code: string } | { seat_code: string }[] | null;
};

type OrderItemLite = {
  id: string;
  status: string;
  is_complimentary?: boolean | null;
};

type SessionWithSeats = SessionRow & {
  seat_codes: string[];
  order_items?: OrderItemLite[];
};

function getTodayDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

export default function OrdersPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionWithSeats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [orderFilter, setOrderFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState(getTodayDateString());
  const [dateTo, setDateTo] = useState(getTodayDateString());

  const loadOrders = useCallback(async () => {
    try {
      setIsLoading(true);

      const { data: sessionData, error: sessionError } = await supabase
        .from("dining_sessions")
        .select(`
          *,
          order_items (
            id,
            status,
            is_complimentary
          )
        `)
        .order("created_at", { ascending: false });

      if (sessionError) throw sessionError;

      const { data: seatData, error: seatError } = await supabase
        .from("session_seats")
        .select(`
          session_id,
          seats:seat_id (
            seat_code
          )
        `);

      if (seatError) throw seatError;

      const seatMap = new Map<string, string[]>();
      for (const row of (seatData ?? []) as SessionSeatRow[]) {
        const seat = Array.isArray(row.seats) ? row.seats[0] : row.seats;
        if (!seat?.seat_code) continue;
        const current = seatMap.get(row.session_id) ?? [];
        current.push(seat.seat_code);
        seatMap.set(row.session_id, current);
      }

      setSessions(
        (sessionData ?? []).map((session) => ({
          ...session,
          seat_codes: [...(seatMap.get(session.id) ?? [])].sort(sortSeatCodes),
        }))
      );
    } catch (error) {
      console.error("載入歷史訂單失敗：", error);
      alert("載入歷史訂單失敗");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  function sortSeatCodes(a: string, b: string) {
    const aIsBar = a.startsWith("A");
    const bIsBar = b.startsWith("A");
    if (aIsBar && bIsBar) return Number(a.replace("A", "")) - Number(b.replace("A", ""));
    return a.localeCompare(b);
  }

  function formatSeatLabel(seatCodes: string[]) {
    if (seatCodes.length === 0) return "—";
    const isAllBar = seatCodes.every((seat) => seat.startsWith("A"));
    if (isAllBar) return seatCodes.join("、");
    return seatCodes.map((seat) => `${seat}桌`).join("、");
  }

  function formatDateTime(value?: string | null) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("zh-TW", { hour12: false });
  }

  function hasComplimentaryItems(session: SessionWithSeats) {
    return (session.order_items ?? []).some(
      (item) => item.status === "active" && item.is_complimentary
    );
  }

  const filteredSessions = useMemo(() => {
    return sessions.filter((session) => {
      const keywordMatch =
        keyword.trim() === "" ||
        session.session_number.toLowerCase().includes(keyword.toLowerCase()) ||
        (session.customer_label ?? "").toLowerCase().includes(keyword.toLowerCase()) ||
        (session.customer_type ?? "").toLowerCase().includes(keyword.toLowerCase()) ||
        session.seat_codes.join(",").toLowerCase().includes(keyword.toLowerCase());

      const paymentMatch =
        paymentFilter === "all" || session.payment_status === paymentFilter;
      const orderMatch = orderFilter === "all" || session.order_status === orderFilter;

      const date = session.created_at ? new Date(session.created_at) : null;
      const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
      const to = dateTo ? new Date(`${dateTo}T23:59:59`) : null;

      const dateMatch =
        !date || Number.isNaN(date.getTime())
          ? false
          : (!from || date >= from) && (!to || date <= to);

      return keywordMatch && paymentMatch && orderMatch && dateMatch;
    });
  }, [sessions, keyword, paymentFilter, orderFilter, dateFrom, dateTo]);

  const stats = useMemo(() => {
    return {
      total: filteredSessions.length,
      paid: filteredSessions.filter((item) => item.payment_status === "paid").length,
      open: filteredSessions.filter((item) => item.order_status === "open").length,
      revenue: filteredSessions.reduce((sum, item) => sum + Number(item.total_amount ?? 0), 0),
    };
  }, [filteredSessions]);

  return (
    <main className="pos-shell p-3 md:p-4">
      <div className="mx-auto flex h-full max-w-[1800px] flex-col gap-3">
        <header className="pos-panel rounded-[28px] px-4 py-3 lg:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-700">
                Order Archive
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-2xl font-bold text-slate-900 lg:text-3xl">歷史訂單</h1>
                <p className="text-sm text-slate-500">縮短頂部高度，保留更多訂單列表空間</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 lg:flex">
              <button
                onClick={() => router.push("/")}
                className="h-11 rounded-2xl bg-slate-100 px-4 text-sm font-semibold text-slate-800"
              >
                返回座位
              </button>
              <button
                onClick={() => router.push("/dashboard")}
                className="h-11 rounded-2xl bg-emerald-100 px-4 text-sm font-semibold text-emerald-900"
              >
                今日後台
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-2 lg:gap-3">
            <StatChip label="篩選後" value={`${stats.total} 筆`} tone="text-slate-900" />
            <StatChip label="已付款" value={`${stats.paid} 筆`} tone="text-emerald-700" />
            <StatChip label="進行中" value={`${stats.open} 筆`} tone="text-amber-700" />
            <StatChip label="總金額" value={`$${stats.revenue}`} tone="text-sky-700" />
          </div>
        </header>

        <section className="pos-panel flex min-h-0 flex-1 flex-col rounded-[28px] p-3 lg:p-4">
          <div className="grid gap-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜尋主單編號 / 客名 / 客群 / 座位"
              className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-amber-400"
            />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-amber-400"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-amber-400"
            />
            <select
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value)}
              className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-amber-400"
            >
              <option value="all">全部付款</option>
              <option value="unpaid">未付款</option>
              <option value="paid">已付款</option>
            </select>
            <select
              value={orderFilter}
              onChange={(e) => setOrderFilter(e.target.value)}
              className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-amber-400"
            >
              <option value="all">全部狀態</option>
              <option value="open">open</option>
              <option value="closed">closed</option>
              <option value="cancelled">cancelled</option>
            </select>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => {
                const today = getTodayDateString();
                setDateFrom(today);
                setDateTo(today);
              }}
              className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              今天
            </button>
            <button
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
              className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              清除日期
            </button>
            <button
              onClick={loadOrders}
              className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900"
            >
              重新整理
            </button>
          </div>

          <div className="mt-3 min-h-0 flex-1">
            <div className="pos-scroll grid h-full min-h-0 gap-3 pr-1 lg:grid-cols-2 xl:grid-cols-3">
              {isLoading ? (
                <div className="rounded-[24px] bg-slate-50 p-5 text-slate-500">載入中...</div>
              ) : filteredSessions.length === 0 ? (
                <div className="rounded-[24px] bg-slate-50 p-5 text-slate-500">查無訂單</div>
              ) : (
                filteredSessions.map((session) => (
                  <article
                    key={session.id}
                    className="flex min-h-[210px] flex-col rounded-[24px] border border-slate-200 bg-white p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs text-slate-500">{formatDateTime(session.created_at)}</p>
                        <h2 className="mt-1 text-xl font-bold text-slate-900">
                          {session.session_number}
                        </h2>
                      </div>
                      <div className="flex flex-col gap-1 text-[11px] font-semibold">
                        <span
                          className={`rounded-full px-2.5 py-1 ${
                            session.payment_status === "paid"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {session.payment_status}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
                          {session.order_status}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <OrderMeta label="座位" value={formatSeatLabel(session.seat_codes)} />
                      <OrderMeta label="來客數" value={`${session.guest_count} 人`} />
                      <OrderMeta label="客類" value={session.customer_type ?? "客人"} />
                      <OrderMeta label="客名" value={session.customer_label || "—"} />
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-slate-500">總金額</p>
                        <p className="text-xl font-bold text-slate-900">
                          ${Number(session.total_amount ?? 0)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-500">
                          {hasComplimentaryItems(session) ? "含招待品項" : "無招待"}
                        </p>
                        <button
                          onClick={() => router.push(`/session/${session.id}`)}
                          className="mt-2 h-10 rounded-2xl bg-sky-500 px-4 text-sm font-semibold text-white"
                        >
                          查看 / 編輯
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="rounded-[20px] bg-slate-50 px-3 py-3">
      <p className="text-[11px] text-slate-500 lg:text-xs">{label}</p>
      <p className={`mt-1 text-xl font-bold lg:text-2xl ${tone}`}>{value}</p>
    </div>
  );
}

function OrderMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}
