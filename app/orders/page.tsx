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
  subtotal_amount: number;
  discount_amount: number;
  total_amount: number;
  tip_amount?: number | null;
  amount_received?: number | null;
  change_amount?: number | null;
  customer_type?: string | null;
  customer_label?: string | null;
  paid_at?: string | null;
  created_at?: string | null;
};

type SessionSeatRow = {
  session_id: string;
  seats:
    | {
        seat_code: string;
      }
    | {
        seat_code: string;
      }[]
    | null;
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
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

        const existing = seatMap.get(row.session_id) ?? [];
        existing.push(seat.seat_code);
        seatMap.set(row.session_id, existing);
      }

      const merged = (sessionData ?? []).map((session) => ({
        ...session,
        seat_codes: [...(seatMap.get(session.id) ?? [])].sort(sortSeatCodes),
      }));

      setSessions(merged);
    } catch (error) {
      console.error("載入歷史訂單失敗：", error);
      alert("載入歷史訂單失敗");
    } finally {
      setIsLoading(false);
    }
  }, []);

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
    const isWithinDateRange = (value?: string | null) => {
      if (!value) return false;
      if (!dateFrom && !dateTo) return true;

      const itemDate = new Date(value);
      if (Number.isNaN(itemDate.getTime())) return false;

      const itemOnly = new Date(
        itemDate.getFullYear(),
        itemDate.getMonth(),
        itemDate.getDate()
      );

      const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
      const to = dateTo ? new Date(`${dateTo}T23:59:59`) : null;

      if (from && itemOnly < from) return false;
      if (to && itemOnly > to) return false;
      return true;
    };

    return sessions.filter((session) => {
      const complimentaryText = hasComplimentaryItems(session) ? "有招待" : "無招待";

      const matchesKeyword =
        keyword.trim() === "" ||
        session.session_number.toLowerCase().includes(keyword.toLowerCase()) ||
        (session.customer_label ?? "").toLowerCase().includes(keyword.toLowerCase()) ||
        (session.customer_type ?? "").toLowerCase().includes(keyword.toLowerCase()) ||
        session.seat_codes.join(",").toLowerCase().includes(keyword.toLowerCase()) ||
        complimentaryText.toLowerCase().includes(keyword.toLowerCase());

      const matchesPayment =
        paymentFilter === "all" || session.payment_status === paymentFilter;
      const matchesOrder = orderFilter === "all" || session.order_status === orderFilter;
      const matchesDate = isWithinDateRange(session.created_at);

      return matchesKeyword && matchesPayment && matchesOrder && matchesDate;
    });
  }, [sessions, keyword, paymentFilter, orderFilter, dateFrom, dateTo]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const stats = useMemo(() => {
    const paid = filteredSessions.filter((item) => item.payment_status === "paid").length;
    const open = filteredSessions.filter((item) => item.order_status === "open").length;
    const revenue = filteredSessions.reduce(
      (sum, item) => sum + Number(item.total_amount ?? 0),
      0
    );

    return { paid, open, revenue };
  }, [filteredSessions]);

  return (
    <main className="pos-shell p-3 md:p-4">
      <div className="mx-auto flex h-full max-w-[1800px] flex-col gap-3 lg:gap-4">
        <header className="pos-panel rounded-[30px] px-4 py-4 lg:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-700">
                Order Archive
              </p>
              <h1 className="mt-2 text-3xl font-bold text-slate-900 lg:text-4xl">歷史訂單</h1>
              <p className="mt-2 text-base text-slate-500">
                固定篩選列 + 內容區內滾動，避免整頁長捲動
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 lg:flex">
              <button
                onClick={() => router.push("/")}
                className="min-h-[58px] rounded-2xl bg-slate-100 px-5 text-base font-semibold text-slate-800 transition hover:bg-slate-200"
              >
                返回座位
              </button>
              <button
                onClick={() => router.push("/dashboard")}
                className="min-h-[58px] rounded-2xl bg-emerald-100 px-5 text-base font-semibold text-emerald-900 transition hover:bg-emerald-200"
              >
                今日後台
              </button>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[
            { label: "篩選後筆數", value: `${filteredSessions.length} 筆`, tone: "text-slate-900" },
            { label: "已付款", value: `${stats.paid} 筆`, tone: "text-emerald-700" },
            { label: "進行中", value: `${stats.open} 筆`, tone: "text-amber-700" },
            { label: "總金額", value: `$${stats.revenue}`, tone: "text-sky-700" },
          ].map((item) => (
            <div key={item.label} className="pos-panel rounded-[28px] px-4 py-4 lg:px-5">
              <p className="text-sm text-slate-500">{item.label}</p>
              <p className={`mt-3 text-3xl font-bold lg:text-4xl ${item.tone}`}>{item.value}</p>
            </div>
          ))}
        </section>

        <section className="pos-panel flex min-h-0 flex-1 flex-col rounded-[32px] p-4 lg:p-5">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜尋主單編號 / 客名 / 客群 / 座位 / 招待"
              className="h-14 rounded-2xl border border-slate-200 bg-white px-4 text-base outline-none focus:border-amber-400"
            />

            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-14 rounded-2xl border border-slate-200 bg-white px-4 text-base outline-none focus:border-amber-400"
            />

            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-14 rounded-2xl border border-slate-200 bg-white px-4 text-base outline-none focus:border-amber-400"
            />

            <select
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value)}
              className="h-14 rounded-2xl border border-slate-200 bg-white px-4 text-base outline-none focus:border-amber-400"
            >
              <option value="all">全部付款狀態</option>
              <option value="unpaid">未付款</option>
              <option value="paid">已付款</option>
            </select>

            <select
              value={orderFilter}
              onChange={(e) => setOrderFilter(e.target.value)}
              className="h-14 rounded-2xl border border-slate-200 bg-white px-4 text-base outline-none focus:border-amber-400"
            >
              <option value="all">全部訂單狀態</option>
              <option value="open">open</option>
              <option value="closed">closed</option>
              <option value="cancelled">cancelled</option>
            </select>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => {
                const today = getTodayDateString();
                setDateFrom(today);
                setDateTo(today);
              }}
              className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
            >
              今天
            </button>
            <button
              onClick={() => {
                const now = new Date();
                const sevenDaysAgo = new Date();
                sevenDaysAgo.setDate(now.getDate() - 6);

                const format = (d: Date) => {
                  const y = d.getFullYear();
                  const m = String(d.getMonth() + 1).padStart(2, "0");
                  const day = String(d.getDate()).padStart(2, "0");
                  return `${y}-${m}-${day}`;
                };

                setDateFrom(format(sevenDaysAgo));
                setDateTo(format(now));
              }}
              className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
            >
              最近 7 天
            </button>
            <button
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
              className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
            >
              清除日期
            </button>
            <button
              onClick={loadOrders}
              className="rounded-full bg-amber-100 px-4 py-2 text-sm font-medium text-amber-900 transition hover:bg-amber-200"
            >
              重新整理
            </button>
          </div>

          <div className="mt-4 min-h-0 flex-1">
            <div className="pos-scroll grid h-full min-h-0 gap-3 pr-1 md:grid-cols-2 2xl:grid-cols-3">
              {isLoading ? (
                <div className="rounded-[28px] bg-slate-50 p-6 text-slate-500">載入中...</div>
              ) : filteredSessions.length === 0 ? (
                <div className="rounded-[28px] bg-slate-50 p-6 text-slate-500">查無訂單</div>
              ) : (
                filteredSessions.map((session) => (
                  <article
                    key={session.id}
                    className="flex min-h-[240px] flex-col rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm text-slate-500">{formatDateTime(session.created_at)}</p>
                        <h2 className="mt-2 text-2xl font-bold text-slate-900">
                          {session.session_number}
                        </h2>
                      </div>

                      <div className="flex flex-col gap-2 text-xs font-semibold">
                        <span
                          className={`rounded-full px-3 py-1 text-center ${
                            session.payment_status === "paid"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {session.payment_status}
                        </span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-center text-slate-700">
                          {session.order_status}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <MetricBox label="座位" value={formatSeatLabel(session.seat_codes)} />
                      <MetricBox label="來客數" value={`${session.guest_count} 人`} />
                      <MetricBox label="客人類型" value={session.customer_type ?? "客人"} />
                      <MetricBox label="客人名稱" value={session.customer_label || "—"} />
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                      <MetricBox label="總金額" value={`$${Number(session.total_amount ?? 0)}`} />
                      <MetricBox label="實收" value={`$${Number(session.amount_received ?? 0)}`} />
                      <MetricBox label="找零" value={`$${Number(session.change_amount ?? 0)}`} />
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                      <span
                        className={`rounded-full px-3 py-2 text-xs font-semibold ${
                          hasComplimentaryItems(session)
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {hasComplimentaryItems(session) ? "含招待品項" : "無招待品項"}
                      </span>

                      <button
                        onClick={() => router.push(`/session/${session.id}`)}
                        className="rounded-2xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-600"
                      >
                        查看 / 編輯
                      </button>
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

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-3 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-2 text-base font-semibold text-slate-900">{value}</p>
    </div>
  );
}
