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
  payment_method?: string | null;
  subtotal_amount: number;
  discount_amount: number;
  total_amount: number;
  tip_amount?: number | null;
  amount_received?: number | null;
  change_amount?: number | null;
  customer_type?: string | null;
  customer_label?: string | null;
  created_at?: string | null;
  paid_at?: string | null;
};

type OrderItemRow = {
  id: string;
  session_id: string;
  product_id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  note?: string | null;
  custom_note?: string | null;
  status: string;
  is_complimentary?: boolean | null;
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

type ActiveSessionCard = {
  id: string;
  session_number: string;
  guest_count: number;
  total_amount: number;
  customer_type?: string | null;
  customer_label?: string | null;
  seat_codes: string[];
  created_at?: string | null;
};

type TimeSlotStat = {
  label: string;
  orderCount: number;
  guestCount: number;
  revenue: number;
};

export default function DashboardPage() {
  const router = useRouter();

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItemRow[]>([]);
  const [activeSessions, setActiveSessions] = useState<ActiveSessionCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    try {
      setIsLoading(true);

      const todayStart = getTodayStart();
      const tomorrowStart = getTomorrowStart();

      const { data: sessionsData, error: sessionsError } = await supabase
        .from("dining_sessions")
        .select("*")
        .gte("created_at", todayStart)
        .lt("created_at", tomorrowStart)
        .order("created_at", { ascending: false });

      if (sessionsError) throw sessionsError;

      const todaySessionIds = (sessionsData ?? []).map((s) => s.id);

      let itemsData: OrderItemRow[] = [];
      if (todaySessionIds.length > 0) {
        const { data, error: itemsError } = await supabase
          .from("order_items")
          .select("*")
          .in("session_id", todaySessionIds);

        if (itemsError) throw itemsError;
        itemsData = data ?? [];
      }

      const { data: activeSessionData, error: activeSessionError } = await supabase
        .from("dining_sessions")
        .select("*")
        .eq("order_status", "open")
        .eq("payment_status", "unpaid")
        .order("created_at", { ascending: false });

      if (activeSessionError) throw activeSessionError;

      const activeSessionIds = (activeSessionData ?? []).map((s) => s.id);

      let seatMap = new Map<string, string[]>();

      if (activeSessionIds.length > 0) {
        const { data: seatData, error: seatError } = await supabase
          .from("session_seats")
          .select(`
            session_id,
            seats:seat_id (
              seat_code
            )
          `)
          .in("session_id", activeSessionIds);

        if (seatError) throw seatError;

        seatMap = buildSeatMap((seatData ?? []) as SessionSeatRow[]);
      }

      const nextActiveSessions: ActiveSessionCard[] = (activeSessionData ?? []).map(
        (session) => ({
          id: session.id,
          session_number: session.session_number,
          guest_count: session.guest_count,
          total_amount: Number(session.total_amount ?? 0),
          customer_type: session.customer_type ?? "客人",
          customer_label: session.customer_label ?? "",
          seat_codes: sortSeatCodes(seatMap.get(session.id) ?? []),
          created_at: session.created_at,
        })
      );

      setSessions(sessionsData ?? []);
      setOrderItems(itemsData);
      setActiveSessions(nextActiveSessions);
    } catch (error) {
      console.error("載入 dashboard 失敗：", error);
      alert("載入 dashboard 失敗");
    } finally {
      setIsLoading(false);
    }
  }

  function getTodayStart() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return start.toISOString();
  }

  function getTomorrowStart() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return next.toISOString();
  }

  function buildSeatMap(rows: SessionSeatRow[]) {
    const seatMap = new Map<string, string[]>();

    for (const row of rows) {
      const seat = Array.isArray(row.seats) ? row.seats[0] : row.seats;
      if (!seat?.seat_code) continue;

      const existing = seatMap.get(row.session_id) ?? [];
      existing.push(seat.seat_code);
      seatMap.set(row.session_id, existing);
    }

    return seatMap;
  }

  function sortSeatCodes(codes: string[]) {
    return [...codes].sort((a, b) => {
      const aIsBar = a.startsWith("A");
      const bIsBar = b.startsWith("A");

      if (aIsBar && bIsBar) {
        return Number(a.replace("A", "")) - Number(b.replace("A", ""));
      }

      return a.localeCompare(b);
    });
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

    return date.toLocaleString("zh-TW", {
      hour12: false,
    });
  }

  const paidSessionsToday = useMemo(() => {
    return sessions.filter((session) => session.payment_status === "paid");
  }, [sessions]);

  const openSessionsToday = useMemo(() => {
    return sessions.filter(
      (session) =>
        session.order_status === "open" && session.payment_status === "unpaid"
    );
  }, [sessions]);

  const todayRevenue = useMemo(() => {
    return paidSessionsToday.reduce(
      (sum, session) => sum + Number(session.total_amount ?? 0),
      0
    );
  }, [paidSessionsToday]);

  const todayGuestCount = useMemo(() => {
    return sessions.reduce((sum, session) => sum + Number(session.guest_count ?? 0), 0);
  }, [sessions]);

  const todayOrderCount = useMemo(() => {
    return sessions.length;
  }, [sessions]);

  const avgTicket = useMemo(() => {
    if (paidSessionsToday.length === 0) return 0;
    return todayRevenue / paidSessionsToday.length;
  }, [paidSessionsToday, todayRevenue]);

  const todayTipTotal = useMemo(() => {
    return sessions.reduce((sum, session) => sum + Number(session.tip_amount ?? 0), 0);
  }, [sessions]);

  const paymentMethodStats = useMemo(() => {
    const stats: Record<string, number> = {};

    for (const session of sessions) {
      const key = session.payment_method || "未設定";
      stats[key] = (stats[key] ?? 0) + 1;
    }

    return stats;
  }, [sessions]);

  const customerTypeStats = useMemo(() => {
    const stats: Record<string, number> = {
      客人: 0,
      朋友: 0,
      熟客: 0,
      粉絲: 0,
    };

    for (const session of sessions) {
      const key = session.customer_type ?? "客人";
      stats[key] = (stats[key] ?? 0) + 1;
    }

    return stats;
  }, [sessions]);

  const todayComplimentaryTotal = useMemo(() => {
    return orderItems.reduce((sum, item) => {
      if (item.status !== "active") return sum;
      if (!item.is_complimentary) return sum;
      return sum + Number(item.line_total ?? 0);
    }, 0);
  }, [orderItems]);

  const topProducts = useMemo(() => {
    const paidSessionIds = new Set(paidSessionsToday.map((session) => session.id));

    const map = new Map<
      string,
      {
        product_name: string;
        quantity: number;
        revenue: number;
      }
    >();

    for (const item of orderItems) {
      if (!paidSessionIds.has(item.session_id)) continue;
      if (item.status !== "active") continue;
      if (item.is_complimentary) continue;

      const existing = map.get(item.product_name) ?? {
        product_name: item.product_name,
        quantity: 0,
        revenue: 0,
      };

      existing.quantity += Number(item.quantity ?? 0);
      existing.revenue += Number(item.line_total ?? 0);

      map.set(item.product_name, existing);
    }

    return [...map.values()]
      .sort((a, b) => {
        if (b.quantity !== a.quantity) return b.quantity - a.quantity;
        return b.revenue - a.revenue;
      })
      .slice(0, 8);
  }, [orderItems, paidSessionsToday]);

  const timeSlotStats = useMemo(() => {
    const slots: TimeSlotStat[] = [
      { label: "00:00–11:59", orderCount: 0, guestCount: 0, revenue: 0 },
      { label: "12:00–13:59", orderCount: 0, guestCount: 0, revenue: 0 },
      { label: "14:00–15:59", orderCount: 0, guestCount: 0, revenue: 0 },
      { label: "16:00–17:59", orderCount: 0, guestCount: 0, revenue: 0 },
      { label: "18:00–23:59", orderCount: 0, guestCount: 0, revenue: 0 },
    ];

    for (const session of sessions) {
      if (!session.created_at) continue;

      const date = new Date(session.created_at);
      if (Number.isNaN(date.getTime())) continue;

      const hour = date.getHours();

      let index = 0;
      if (hour >= 12 && hour < 14) index = 1;
      else if (hour >= 14 && hour < 16) index = 2;
      else if (hour >= 16 && hour < 18) index = 3;
      else if (hour >= 18) index = 4;

      slots[index].orderCount += 1;
      slots[index].guestCount += Number(session.guest_count ?? 0);

      if (session.payment_status === "paid") {
        slots[index].revenue += Number(session.total_amount ?? 0);
      }
    }

    return slots;
  }, [sessions]);

  const maxTopProductQty = Math.max(...topProducts.map((item) => item.quantity), 1);
  const maxTimeSlotRevenue = Math.max(...timeSlotStats.map((item) => item.revenue), 1);
  const maxPaymentMethodCount = Math.max(...Object.values(paymentMethodStats), 1);

  if (isLoading) {
    return <main className="p-8">載入中...</main>;
  }

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
            onClick={() => router.push("/orders")}
            className="rounded-xl bg-blue-100 px-4 py-2 text-sm font-medium text-blue-800 hover:bg-blue-200"
          >
            前往歷史訂單
          </button>

          <button
            onClick={loadDashboard}
            className="rounded-xl bg-amber-100 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-200"
          >
            重新整理
          </button>
        </div>
      </div>

      <section className="mb-6 rounded-2xl bg-white p-6 shadow-lg">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">今日即時後台</h1>
            <p className="mt-1 text-gray-500">查看今天的營業額、來客數、熱門商品與現場狀態</p>
          </div>

          <div className="text-sm text-gray-500">
            更新時間：{new Date().toLocaleString("zh-TW", { hour12: false })}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-7">
          <div className="rounded-2xl bg-emerald-50 p-5">
            <p className="text-sm text-emerald-700">今日營業額</p>
            <p className="mt-2 text-3xl font-bold text-emerald-900">${todayRevenue}</p>
            <p className="mt-1 text-sm text-emerald-700">已付款訂單加總</p>
          </div>

          <div className="rounded-2xl bg-blue-50 p-5">
            <p className="text-sm text-blue-700">今日來客數</p>
            <p className="mt-2 text-3xl font-bold text-blue-900">{todayGuestCount} 人</p>
            <p className="mt-1 text-sm text-blue-700">今天所有主單人數總和</p>
          </div>

          <div className="rounded-2xl bg-violet-50 p-5">
            <p className="text-sm text-violet-700">今日訂單數</p>
            <p className="mt-2 text-3xl font-bold text-violet-900">{todayOrderCount} 張</p>
            <p className="mt-1 text-sm text-violet-700">包含已付款與未付款</p>
          </div>

          <div className="rounded-2xl bg-amber-50 p-5">
            <p className="text-sm text-amber-700">平均客單價</p>
            <p className="mt-2 text-3xl font-bold text-amber-900">
              ${Math.round(avgTicket)}
            </p>
            <p className="mt-1 text-sm text-amber-700">營業額 ÷ 已付款訂單數</p>
          </div>

          <div className="rounded-2xl bg-rose-50 p-5">
            <p className="text-sm text-rose-700">未結帳桌數</p>
            <p className="mt-2 text-3xl font-bold text-rose-900">
              {openSessionsToday.length} 張
            </p>
            <p className="mt-1 text-sm text-rose-700">目前 open + unpaid</p>
          </div>

          <div className="rounded-2xl bg-fuchsia-50 p-5">
            <p className="text-sm text-fuchsia-700">今日小費總額</p>
            <p className="mt-2 text-3xl font-bold text-fuchsia-900">${todayTipTotal}</p>
            <p className="mt-1 text-sm text-fuchsia-700">今日所有主單小費加總</p>
          </div>

          <div className="rounded-2xl bg-orange-50 p-5">
            <p className="text-sm text-orange-700">今日招待金額總額</p>
            <p className="mt-2 text-3xl font-bold text-orange-900">
              ${todayComplimentaryTotal}
            </p>
            <p className="mt-1 text-sm text-orange-700">招待品項原價加總</p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-12 gap-6">
        <section className="col-span-12 rounded-2xl bg-white p-6 shadow-lg xl:col-span-7">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900">目前未結帳訂單</h2>
            <span className="text-sm text-gray-500">共 {activeSessions.length} 張</span>
          </div>

          <div className="mt-6 space-y-3">
            {activeSessions.length === 0 ? (
              <div className="rounded-xl bg-gray-50 p-5 text-gray-500">目前沒有未結帳訂單</div>
            ) : (
              activeSessions.map((session) => (
                <div
                  key={session.id}
                  className="rounded-2xl border border-gray-200 bg-gray-50 p-4"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                      <p className="text-lg font-bold text-gray-900">
                        {session.session_number}
                      </p>
                      <p className="text-sm text-gray-600">
                        座位：{formatSeatLabel(session.seat_codes)}
                      </p>
                      <p className="text-sm text-gray-600">
                        來客數：{session.guest_count} 人
                      </p>
                      <p className="text-sm text-gray-600">
                        客群：{session.customer_type ?? "客人"}
                        {session.customer_label ? ` / ${session.customer_label}` : ""}
                      </p>
                      <p className="text-sm text-gray-500">
                        建立時間：{formatDateTime(session.created_at)}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-sm text-gray-500">目前金額</p>
                        <p className="text-2xl font-bold text-gray-900">
                          ${Number(session.total_amount ?? 0)}
                        </p>
                      </div>

                      <button
                        onClick={() => router.push(`/session/${session.id}`)}
                        className="rounded-xl bg-blue-500 px-4 py-3 text-sm font-medium text-white hover:bg-blue-600"
                      >
                        進入訂單
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="col-span-12 rounded-2xl bg-white p-6 shadow-lg xl:col-span-5">
          <h2 className="text-2xl font-bold text-gray-900">客人類型分布</h2>

          <div className="mt-6 space-y-4">
            {Object.entries(customerTypeStats).map(([type, count]) => {
              const percentage =
                todayOrderCount === 0 ? 0 : Math.round((count / todayOrderCount) * 100);

              return (
                <div key={type}>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-700">{type}</span>
                    <span className="text-gray-500">
                      {count} 組 / {percentage}%
                    </span>
                  </div>

                  <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-amber-400"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="col-span-12 rounded-2xl bg-white p-6 shadow-lg xl:col-span-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900">付款方式分布</h2>
            <span className="text-sm text-gray-500">今天所有主單</span>
          </div>

          <div className="mt-6 space-y-4">
            {Object.keys(paymentMethodStats).length === 0 ? (
              <div className="rounded-xl bg-gray-50 p-5 text-gray-500">今天還沒有付款方式資料</div>
            ) : (
              Object.entries(paymentMethodStats).map(([method, count]) => {
                const width =
                  maxPaymentMethodCount === 0
                    ? "0%"
                    : `${(count / maxPaymentMethodCount) * 100}%`;

                return (
                  <div key={method}>
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-700">{method}</span>
                      <span className="text-gray-500">{count} 筆</span>
                    </div>

                    <div className="h-4 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-indigo-500"
                        style={{ width }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="col-span-12 rounded-2xl bg-white p-6 shadow-lg xl:col-span-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900">今日熱門商品</h2>
            <span className="text-sm text-gray-500">只計已付款且非招待品項</span>
          </div>

          <div className="mt-6 overflow-x-auto">
            {topProducts.length === 0 ? (
              <div className="rounded-xl bg-gray-50 p-5 text-gray-500">
                今天還沒有已付款商品資料
              </div>
            ) : (
              <table className="min-w-full border-separate border-spacing-y-3">
                <thead>
                  <tr className="text-left text-sm text-gray-500">
                    <th className="px-4">排名</th>
                    <th className="px-4">商品名稱</th>
                    <th className="px-4">賣出杯數 / 份數</th>
                    <th className="px-4">營收</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((product, index) => (
                    <tr key={product.product_name} className="bg-gray-50">
                      <td className="rounded-l-2xl px-4 py-4 font-bold text-gray-900">
                        #{index + 1}
                      </td>
                      <td className="px-4 py-4 text-gray-900">{product.product_name}</td>
                      <td className="px-4 py-4 text-gray-900">{product.quantity}</td>
                      <td className="rounded-r-2xl px-4 py-4 font-bold text-gray-900">
                        ${product.revenue}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="col-span-12 rounded-2xl bg-white p-6 shadow-lg xl:col-span-6">
          <h2 className="text-2xl font-bold text-gray-900">今日摘要</h2>

          <div className="mt-6 space-y-4 text-gray-700">
            <div className="rounded-2xl bg-gray-50 p-4">
              <p className="text-sm text-gray-500">已付款訂單</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {paidSessionsToday.length} 張
              </p>
            </div>

            <div className="rounded-2xl bg-gray-50 p-4">
              <p className="text-sm text-gray-500">未付款訂單</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {openSessionsToday.length} 張
              </p>
            </div>

            <div className="rounded-2xl bg-gray-50 p-4">
              <p className="text-sm text-gray-500">粉絲來店</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {customerTypeStats["粉絲"] ?? 0} 組
              </p>
            </div>

            <div className="rounded-2xl bg-gray-50 p-4">
              <p className="text-sm text-gray-500">熟客來店</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {customerTypeStats["熟客"] ?? 0} 組
              </p>
            </div>

            <div className="rounded-2xl bg-gray-50 p-4">
              <p className="text-sm text-gray-500">朋友來店</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {customerTypeStats["朋友"] ?? 0} 組
              </p>
            </div>
          </div>
        </section>

        <section className="col-span-12 rounded-2xl bg-white p-6 shadow-lg">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900">今日時段統計</h2>
            <span className="text-sm text-gray-500">依建立訂單時間分段</span>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            {timeSlotStats.map((slot) => (
              <div key={slot.label} className="rounded-2xl bg-gray-50 p-5">
                <p className="text-sm text-gray-500">{slot.label}</p>
                <div className="mt-4 space-y-2">
                  <p className="text-gray-700">
                    訂單數：
                    <span className="ml-2 font-bold text-gray-900">{slot.orderCount}</span>
                  </p>
                  <p className="text-gray-700">
                    來客數：
                    <span className="ml-2 font-bold text-gray-900">{slot.guestCount}</span>
                  </p>
                  <p className="text-gray-700">
                    營業額：
                    <span className="ml-2 font-bold text-gray-900">${slot.revenue}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="col-span-12 rounded-2xl bg-white p-6 shadow-lg xl:col-span-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900">熱門商品圖表</h2>
            <span className="text-sm text-gray-500">以賣出數量排序</span>
          </div>

          <div className="mt-6 space-y-4">
            {topProducts.length === 0 ? (
              <div className="rounded-xl bg-gray-50 p-5 text-gray-500">
                今天還沒有已付款商品資料
              </div>
            ) : (
              topProducts.map((product) => {
                const width = `${(product.quantity / maxTopProductQty) * 100}%`;

                return (
                  <div key={product.product_name}>
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-700">{product.product_name}</span>
                      <span className="text-gray-500">{product.quantity} 份</span>
                    </div>

                    <div className="h-4 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-blue-500"
                        style={{ width }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="col-span-12 rounded-2xl bg-white p-6 shadow-lg xl:col-span-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900">時段營業額圖表</h2>
            <span className="text-sm text-gray-500">以已付款營業額顯示</span>
          </div>

          <div className="mt-6 space-y-4">
            {timeSlotStats.map((slot) => {
              const width =
                maxTimeSlotRevenue === 0
                  ? "0%"
                  : `${(slot.revenue / maxTimeSlotRevenue) * 100}%`;

              return (
                <div key={slot.label}>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-700">{slot.label}</span>
                    <span className="text-gray-500">${slot.revenue}</span>
                  </div>

                  <div className="h-4 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}