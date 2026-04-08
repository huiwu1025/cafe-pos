import { createClient } from "@supabase/supabase-js";
import {
  listSheetTitles,
  mergeRowsByKey,
  readSheetValues,
  replaceSheetValues,
} from "@/lib/google-sheets";

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

type ProductCostItem = {
  name: string;
  category: string;
  price: number;
  unitCost: number;
  grossProfit: number;
  grossMargin: number | string;
  featured: string;
  notes: string;
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

function getCostSpreadsheetId() {
  return process.env.GOOGLE_COST_SOURCE_SPREADSHEET_ID?.trim() ?? "";
}

function toNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "").replace(/[^\d.-]/g, "");
  if (!text) return 0;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toPercentValue(value: string | number | null | undefined) {
  if (typeof value === "number") return value <= 1 ? value : value / 100;
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.includes("%")) {
    const parsed = Number(text.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed / 100 : "";
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return "";
  return parsed <= 1 ? parsed : parsed / 100;
}

function findHeaderRowIndex(rows: string[][], headers: string[]) {
  return rows.findIndex((row) => headers.every((header) => row.includes(header)));
}

function mapRowByHeader(headers: string[], row: string[]) {
  const mapped = new Map<string, string>();
  headers.forEach((header, index) => {
    mapped.set(header, row[index] ?? "");
  });
  return mapped;
}

function normalizeProductName(name: string) {
  return name.trim();
}

function calculatePaymentFee(amount: number, paymentMethod: string | null | undefined) {
  const method = (paymentMethod ?? "").trim();
  if (!amount || amount <= 0) return 0;
  if (method === "歐付寶") {
    return Math.max(1, Math.round(amount * 0.0245));
  }
  if (method === "TWQR") {
    return Math.max(1, Math.round(amount * 0.029));
  }
  return 0;
}

async function loadProductCosts() {
  const sourceSpreadsheetId = getCostSpreadsheetId();
  if (!sourceSpreadsheetId) {
    return {
      sourceSpreadsheetId: "",
      productCosts: [] as ProductCostItem[],
      fixedExpenseRows: [] as string[][],
      availableSheets: [] as string[],
    };
  }

  const availableSheets = await listSheetTitles(sourceSpreadsheetId);

  const productCostRows = await readSheetValues("品項成本表", sourceSpreadsheetId);
  const productHeaderIndex = findHeaderRowIndex(productCostRows, ["品項名稱", "類別", "售價", "單位成本"]);
  const productCosts: ProductCostItem[] = [];

  if (productHeaderIndex >= 0) {
    const headers = productCostRows[productHeaderIndex];
    for (const row of productCostRows.slice(productHeaderIndex + 1)) {
      const mapped = mapRowByHeader(headers, row);
      const name = normalizeProductName(mapped.get("品項名稱") ?? "");
      if (!name) continue;
      productCosts.push({
        name,
        category: mapped.get("類別") ?? "",
        price: toNumber(mapped.get("售價")),
        unitCost: toNumber(mapped.get("單位成本")),
        grossProfit: toNumber(mapped.get("單杯/份毛利")),
        grossMargin: toPercentValue(mapped.get("單杯/份毛利率")),
        featured: mapped.get("是否主打") ?? "",
        notes: mapped.get("備註") ?? "",
      });
    }
  }

  const fixedExpenseRows = await readSheetValues("固定與其他支出", sourceSpreadsheetId);

  return {
    sourceSpreadsheetId,
    productCosts,
    fixedExpenseRows,
    availableSheets,
  };
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

  const { productCosts, fixedExpenseRows, availableSheets } = await loadProductCosts();
  const productCostMap = new Map(productCosts.map((item) => [normalizeProductName(item.name), item]));

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

  const paymentSummary = new Map<
    string,
    { count: number; grossAmount: number; feeAmount: number; netAmount: number }
  >();

  for (const session of paidSessions) {
    const method = session.payment_method?.trim() || "未填付款方式";
    const grossAmount = Number(session.total_amount ?? 0);
    const feeAmount = calculatePaymentFee(grossAmount, method);
    const existing = paymentSummary.get(method) ?? {
      count: 0,
      grossAmount: 0,
      feeAmount: 0,
      netAmount: 0,
    };
    existing.count += 1;
    existing.grossAmount += grossAmount;
    existing.feeAmount += feeAmount;
    existing.netAmount += grossAmount - feeAmount;
    paymentSummary.set(method, existing);
  }

  const totalPaymentFees = Array.from(paymentSummary.values()).reduce(
    (sum, item) => sum + item.feeAmount,
    0
  );
  const netRevenue = revenue - totalPaymentFees;

  const activeOrderItems = orderItems.filter((item) => item.status === "active");
  const itemProfitSummary = new Map<
    string,
    { category: string; quantity: number; salesAmount: number; unitCost: number; estimatedCost: number; grossProfit: number; grossMargin: number | string; notes: string }
  >();

  for (const item of activeOrderItems) {
    const productName = normalizeProductName(item.product_name ?? "");
    if (!productName) continue;
    const productCost = productCostMap.get(productName);
    const quantity = Number(item.quantity ?? 0);
    const salesAmount = Number(item.line_total ?? 0);
    const estimatedCost = quantity * Number(productCost?.unitCost ?? 0);
    const grossProfit = salesAmount - estimatedCost;
    const existing = itemProfitSummary.get(productName) ?? {
      category: productCost?.category ?? "",
      quantity: 0,
      salesAmount: 0,
      unitCost: Number(productCost?.unitCost ?? 0),
      estimatedCost: 0,
      grossProfit: 0,
      grossMargin: productCost?.grossMargin ?? "",
      notes: productCost?.notes ?? "",
    };
    existing.quantity += quantity;
    existing.salesAmount += salesAmount;
    existing.estimatedCost += estimatedCost;
    existing.grossProfit += grossProfit;
    itemProfitSummary.set(productName, existing);
  }

  const totalEstimatedCost = Array.from(itemProfitSummary.values()).reduce(
    (sum, item) => sum + item.estimatedCost,
    0
  );
  const grossProfitAfterCost = revenue - totalEstimatedCost;
  const grossMarginAfterCost = revenue > 0 ? grossProfitAfterCost / revenue : "";

  await mergeRowsByKey(
    "每日摘要",
    [
      "營業日期",
      "今日營業額",
      "今日來客數",
      "今日訂單數",
      "已付款訂單數",
      "未付款訂單數",
      "平均客單價",
      "招待總額",
      "現金收款",
      "金流手續費",
      "淨收入",
      "估算餐點成本",
      "估算毛利",
      "估算毛利率",
      "開店現金",
      "關帳現金",
      "系統應有現金",
      "關帳差額",
      "同步時間",
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
        totalPaymentFees,
        netRevenue,
        totalEstimatedCost,
        grossProfitAfterCost,
        grossMarginAfterCost === "" ? "" : grossMarginAfterCost,
        cashCount?.opening_cash ?? "",
        cashCount?.closing_cash ?? "",
        expectedClosingCash,
        closingDifference,
        new Date().toISOString(),
      ],
    ]
  );

  await mergeRowsByKey(
    "現金清點",
    [
      "營業日期",
      "開店現金",
      "開店清點時間",
      "開店備註",
      "關帳現金",
      "關帳清點時間",
      "關帳備註",
      "今日現金收款",
      "系統應有現金",
      "關帳差額",
      "同步時間",
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
    "訂單明細",
    [
      "主單ID",
      "營業日期",
      "主單編號",
      "建立時間",
      "來客數",
      "訂單狀態",
      "付款狀態",
      "付款方式",
      "餐點小計",
      "折扣金額",
      "總計金額",
      "客人類型",
      "客人標記",
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

  await replaceSheetValues(
    "品項成本",
    [
      ["品項名稱", "類別", "售價", "單位成本", "單杯/份毛利", "單杯/份毛利率", "是否主打", "備註"],
      ...productCosts.map((item) => [
        item.name,
        item.category,
        item.price,
        item.unitCost,
        item.grossProfit,
        item.grossMargin,
        item.featured,
        item.notes,
      ]),
    ]
  );

  await replaceSheetValues(
    "品項毛利",
    [
      ["品項名稱", "類別", "今日售出杯數", "今日銷售額", "單位成本", "估算總成本", "估算毛利", "參考毛利率", "備註"],
      ...Array.from(itemProfitSummary.entries()).map(([productName, item]) => [
        productName,
        item.category,
        item.quantity,
        item.salesAmount,
        item.unitCost,
        item.estimatedCost,
        item.grossProfit,
        item.grossMargin,
        item.notes,
      ]),
    ]
  );

  await mergeRowsByKey(
    "每日毛利",
    [
      "營業日期",
      "今日營業額",
      "估算餐點成本",
      "估算毛利",
      "估算毛利率",
      "金流手續費",
      "淨收入",
      "同步時間",
    ],
    [
      [
        businessDate,
        revenue,
        totalEstimatedCost,
        grossProfitAfterCost,
        grossMarginAfterCost === "" ? "" : grossMarginAfterCost,
        totalPaymentFees,
        netRevenue,
        new Date().toISOString(),
      ],
    ]
  );

  if (fixedExpenseRows.length > 0) {
    const nonEmptyRows = fixedExpenseRows.filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
    if (nonEmptyRows.length > 0) {
      await replaceSheetValues("固定支出", nonEmptyRows);
    }
  }

  await replaceSheetValues(
    "付款方式淨收入",
    [
      ["付款方式", "今日筆數", "今日收款", "手續費", "淨收入"],
      ...Array.from(paymentSummary.entries()).map(([method, item]) => [
        method,
        item.count,
        item.grossAmount,
        item.feeAmount,
        item.netAmount,
      ]),
    ]
  );

  await replaceSheetValues(
    "成本同步說明",
    [
      ["項目", "內容"],
      ["來源試算表", getCostSpreadsheetId() || "尚未設定 GOOGLE_COST_SOURCE_SPREADSHEET_ID"],
      ["已掃描分頁", availableSheets.join("、") || "未提供來源成本表"],
      ["目前手續費規則", "歐付寶 2.45% / 每筆最低 1 元；現金與其他先視為 0 元"],
    ]
  );

  return {
    businessDate,
    revenue,
    guests,
    sessions: sessions.length,
    cashRevenue,
    totalPaymentFees,
    netRevenue,
    costItems: productCosts.length,
  };
}
