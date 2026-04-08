import { createClient } from "@supabase/supabase-js";
import { mergeRowsByKey } from "@/lib/google-sheets";

type SessionRow = {
  id: string;
  session_number: string;
  guest_count: number;
  order_status: string;
  payment_status: string;
  payment_method?: string | null;
  total_amount: number;
  subtotal_amount?: number | null;
  discount_amount?: number | null;
  customer_type?: string | null;
  customer_label?: string | null;
  created_at?: string | null;
};

type OrderItemRow = {
  id: string;
  session_id: string;
  product_name: string;
  quantity: number;
  line_total: number;
  status: string;
  is_complimentary?: boolean | null;
};

type CashCountRow = {
  business_date: string;
  opening_cash: number | null;
  opening_notes: string | null;
  opening_counted_at: string | null;
  closing_cash: number | null;
  closing_notes: string | null;
  closing_counted_at: string | null;
};

function todayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_ENV_MISSING");
  }

  return createClient(url, key);
}

export async function syncTodayDashboardToGoogleSheets() {
  const supabase = getSupabaseServerClient();
  const businessDate = todayIsoDate();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const { data: sessionsData, error: sessionsError } = await supabase
    .from("dining_sessions")
    .select("*")
    .gte("created_at", todayStart.toISOString())
    .lt("created_at", tomorrowStart.toISOString())
    .order("created_at", { ascending: true });

  if (sessionsError) throw sessionsError;

  const sessions = (sessionsData ?? []) as SessionRow[];
  const sessionIds = sessions.map((session) => session.id);

  let orderItems: OrderItemRow[] = [];
  if (sessionIds.length > 0) {
    const { data: orderItemsData, error: orderItemsError } = await supabase
      .from("order_items")
      .select("*")
      .in("session_id", sessionIds);

    if (orderItemsError) throw orderItemsError;
    orderItems = (orderItemsData ?? []) as OrderItemRow[];
  }

  let cashCount: CashCountRow | null = null;
  const { data: cashData, error: cashError } = await supabase
    .from("daily_cash_counts")
    .select("*")
    .eq("business_date", businessDate)
    .maybeSingle();

  if (cashError) {
    const maybeMessage = (cashError as { message?: string }).message ?? "";
    if (!maybeMessage.includes("daily_cash_counts")) {
      throw cashError;
    }
  } else {
    cashCount = cashData as CashCountRow | null;
  }

  const paidSessions = sessions.filter((session) => session.payment_status === "paid");
  const unpaidSessions = sessions.filter((session) => session.payment_status !== "paid");
  const revenue = paidSessions.reduce((sum, session) => sum + Number(session.total_amount ?? 0), 0);
  const guests = sessions.reduce((sum, session) => sum + Number(session.guest_count ?? 0), 0);
  const cashRevenue = paidSessions.reduce((sum, session) => {
    return (session.payment_method ?? "") === "現金"
      ? sum + Number(session.total_amount ?? 0)
      : sum;
  }, 0);
  const complimentaryTotal = orderItems.reduce((sum, item) => {
    if (item.status !== "active" || !item.is_complimentary) return sum;
    return sum + Number(item.line_total ?? 0);
  }, 0);
  const averageTicket = paidSessions.length > 0 ? Math.round(revenue / paidSessions.length) : 0;
  const expectedClosingCash = Number(cashCount?.opening_cash ?? 0) + cashRevenue;
  const closingDifference =
    cashCount?.closing_cash != null ? Number(cashCount.closing_cash) - expectedClosingCash : "";

  await mergeRowsByKey(
    "Daily Summary",
    [
      "business_date",
      "revenue",
      "guests",
      "order_count",
      "paid_order_count",
      "unpaid_order_count",
      "average_ticket",
      "complimentary_total",
      "cash_revenue",
      "opening_cash",
      "closing_cash",
      "expected_closing_cash",
      "closing_difference",
      "synced_at",
    ],
    [
      [
        businessDate,
        revenue,
        guests,
        sessions.length,
        paidSessions.length,
        unpaidSessions.length,
        averageTicket,
        complimentaryTotal,
        cashRevenue,
        cashCount?.opening_cash ?? "",
        cashCount?.closing_cash ?? "",
        expectedClosingCash,
        closingDifference,
        new Date().toISOString(),
      ],
    ]
  );

  await mergeRowsByKey(
    "Cash Counts",
    [
      "business_date",
      "opening_cash",
      "opening_counted_at",
      "opening_notes",
      "closing_cash",
      "closing_counted_at",
      "closing_notes",
      "cash_revenue",
      "expected_closing_cash",
      "closing_difference",
      "synced_at",
    ],
    [
      [
        businessDate,
        cashCount?.opening_cash ?? "",
        cashCount?.opening_counted_at ?? "",
        cashCount?.opening_notes ?? "",
        cashCount?.closing_cash ?? "",
        cashCount?.closing_counted_at ?? "",
        cashCount?.closing_notes ?? "",
        cashRevenue,
        expectedClosingCash,
        closingDifference,
        new Date().toISOString(),
      ],
    ]
  );

  await mergeRowsByKey(
    "Session Details",
    [
      "session_id",
      "business_date",
      "session_number",
      "created_at",
      "guest_count",
      "order_status",
      "payment_status",
      "payment_method",
      "subtotal_amount",
      "discount_amount",
      "total_amount",
      "customer_type",
      "customer_label",
    ],
    sessions.map((session) => [
      session.id,
      businessDate,
      session.session_number,
      session.created_at ?? "",
      Number(session.guest_count ?? 0),
      session.order_status,
      session.payment_status,
      session.payment_method ?? "",
      Number(session.subtotal_amount ?? 0),
      Number(session.discount_amount ?? 0),
      Number(session.total_amount ?? 0),
      session.customer_type ?? "",
      session.customer_label ?? "",
    ])
  );

  return {
    businessDate,
    revenue,
    guests,
    sessions: sessions.length,
    cashRevenue,
  };
}
