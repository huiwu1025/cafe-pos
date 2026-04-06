"use client";

import { useEffect, useMemo, useState } from "react";
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

  useEffect(() => {
    loadOrders();
  }, []);

  async function loadOrders() {
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

      const merged = (sessionData ?? []).map((session) => {
        const rawSeatCodes = seatMap.get(session.id) ?? [];
        const seatCodes = [...rawSeatCodes].sort((a, b) => {
          const aIsBar = a.startsWith("A");
          const bIsBar = b.startsWith("A");

          if (aIsBar && bIsBar) {
            return Number(a.replace("A", "")) - Number(b.replace("A", ""));
          }

          return a.localeCompare(b);
        });

        return {
          ...session,
          seat_codes: seatCodes,
        };
      });

      setSessions(merged);
    } catch (error) {
      console.error("載入歷史訂單失敗：", error);
      alert("載入歷史訂單失敗");
    } finally {
      setIsLoading(false);
    }
  }

  function formatSeatLabel(seatCodes: string[]) {
    if (seatCodes.length === 0) return "—";
    const isAllBar = seatCodes.every((seat) => seat.startsWith("A"));
    if (isAllBar) return seatCodes.join("、");
    return seatCodes.map((seat) => `${seat}桌`).join("、");
  }

  function formatTime(value?: string | null) {
    if (!value) return "—";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";

    return date.toLocaleString("zh-TW", {
      hour12: false,
    });
  }

  function isWithinDateRange(value?: string | null) {
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
  }

  function hasComplimentaryItems(session: SessionWithSeats) {
    return (session.order_items ?? []).some(
      (item) => item.status === "active" && item.is_complimentary
    );
  }

  const filteredSessions = useMemo(() => {
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

      const matchesOrder =
        orderFilter === "all" || session.order_status === orderFilter;

      const matchesDate = isWithinDateRange(session.created_at);

      return matchesKeyword && matchesPayment && matchesOrder && matchesDate;
    });
  }, [sessions, keyword, paymentFilter, orderFilter, dateFrom, dateTo]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="mb-6 flex items-center justify-between">
        <button
          onClick={() => router.push("/")}
          className="rounded-xl bg-gray-100 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-200"
        >
          ← 返回首頁
        </button>

        <div className="flex gap-2">
          <button
            onClick={() => router.push("/dashboard")}
            className="rounded-xl bg-blue-100 px-4 py-2 text-sm font-medium text-blue-800 hover:bg-blue-200"
          >
            前往今日後台
          </button>
        </div>
      </div>

      <section className="rounded-2xl bg-white p-6 shadow-lg">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">歷史訂單</h1>
            <p className="mt-1 text-gray-500">可搜尋、日期篩選、查看與再次進入訂單頁</p>
          </div>

          <button
            onClick={loadOrders}
            className="rounded-xl bg-amber-100 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-200"
          >
            重新整理
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-6">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜尋主單編號 / 客名 / 客群 / 座位 / 招待"
            className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-amber-500 md:col-span-2"
          />

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-amber-500"
          />

          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-amber-500"
          />

          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-amber-500"
          >
            <option value="all">全部付款狀態</option>
            <option value="unpaid">未付款</option>
            <option value="paid">已付款</option>
          </select>

          <select
            value={orderFilter}
            onChange={(e) => setOrderFilter(e.target.value)}
            className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-amber-500"
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
            className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200"
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
            className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200"
          >
            最近 7 天
          </button>

          <button
            onClick={() => {
              setDateFrom("");
              setDateTo("");
            }}
            className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200"
          >
            清除日期
          </button>
        </div>

        <div className="mt-4 rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-600">
          共 {filteredSessions.length} 筆
        </div>

        <div className="mt-6 overflow-x-auto">
          {isLoading ? (
            <div className="rounded-xl bg-gray-50 p-6 text-gray-500">載入中...</div>
          ) : filteredSessions.length === 0 ? (
            <div className="rounded-xl bg-gray-50 p-6 text-gray-500">查無訂單</div>
          ) : (
            <table className="min-w-[1700px] border-separate border-spacing-y-3">
              <thead>
                <tr className="text-left text-sm text-gray-500">
                  <th className="px-4">建立時間</th>
                  <th className="px-4">主單編號</th>
                  <th className="px-4">座位</th>
                  <th className="px-4">來客數</th>
                  <th className="px-4">客人類型</th>
                  <th className="px-4">客人名稱</th>
                  <th className="px-4">訂單狀態</th>
                  <th className="px-4">付款狀態</th>
                  <th className="px-4">小費</th>
                  <th className="px-4">實收</th>
                  <th className="px-4">找零</th>
                  <th className="px-4">招待品項</th>
                  <th className="px-4">總金額</th>
                  <th className="px-4">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map((session) => (
                  <tr
                    key={session.id}
                    className="rounded-2xl bg-gray-50 text-gray-900 shadow-sm"
                  >
                    <td className="rounded-l-2xl px-4 py-4">
                      {formatTime(session.created_at)}
                    </td>
                    <td className="px-4 py-4 font-semibold">{session.session_number}</td>
                    <td className="px-4 py-4">{formatSeatLabel(session.seat_codes)}</td>
                    <td className="px-4 py-4">{session.guest_count} 人</td>
                    <td className="px-4 py-4">{session.customer_type ?? "客人"}</td>
                    <td className="px-4 py-4">{session.customer_label || "—"}</td>
                    <td className="px-4 py-4">{session.order_status}</td>
                    <td className="px-4 py-4">{session.payment_status}</td>
                    <td className="px-4 py-4">${Number(session.tip_amount ?? 0)}</td>
                    <td className="px-4 py-4">${Number(session.amount_received ?? 0)}</td>
                    <td className="px-4 py-4">${Number(session.change_amount ?? 0)}</td>
                    <td className="px-4 py-4">
                      {hasComplimentaryItems(session) ? (
                        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                          有
                        </span>
                      ) : (
                        <span className="text-gray-400">無</span>
                      )}
                    </td>
                    <td className="px-4 py-4 font-bold">
                      ${Number(session.total_amount ?? 0)}
                    </td>
                    <td className="rounded-r-2xl px-4 py-4">
                      <button
                        onClick={() => router.push(`/session/${session.id}`)}
                        className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
                      >
                        查看 / 編輯
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  );
}