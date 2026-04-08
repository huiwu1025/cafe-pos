import { createClient } from "@supabase/supabase-js";
import {
  listSheetTitles,
  mergeRowsByKey,
  readSheetValues,
  replaceSheetRangeValues,
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
  tip_amount?: number | null;
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

type FixedExpenseRow = {
  date: string;
  month: string;
  item: string;
  type: string;
  amount: number;
  isPaid: boolean;
  note: string;
};

type ProcurementRow = {
  date: string;
  month: string;
  item: string;
  type: string;
  unitPrice: number;
  quantity: number;
  totalAmount: number;
  supplier: string;
  note: string;
};

type ItemProfitSummary = {
  category: string;
  quantity: number;
  salesAmount: number;
  unitCost: number;
  estimatedCost: number;
  grossProfit: number;
  grossMargin: number | string;
  featured: string;
  notes: string;
};

type DailyMetric = {
  date: string;
  month: string;
  guestCount: number;
  productRevenue: number;
  cashIncome: number;
  transferIncome: number;
  otherIncome: number;
  tip: number;
  discount: number;
  complimentary: number;
  refund: number;
  actualReceived: number;
  productCost: number;
  grossProfit: number;
  paymentFees: number;
  reconciliationDiff: number | string;
  rent: number;
};

type MonthlyMetric = {
  month: string;
  guestCount: number;
  productRevenue: number;
  tip: number;
  otherIncome: number;
  discount: number;
  complimentary: number;
  refund: number;
  actualReceived: number;
  productCost: number;
  procurementCost: number;
  fixedExpense: number;
  rent: number;
  paymentFees: number;
  netIncome: number;
  netCashFlow: number;
};

const TAIPEI_TIMEZONE = "Asia/Taipei";
const SOURCE_PRODUCT_COST_SHEET = "品項成本表";
const SOURCE_PROCUREMENT_SHEET = "成本控管表";
const SOURCE_FIXED_EXPENSE_SHEET = "固定與其他支出";
const SOURCE_DAILY_OVERVIEW_SHEET = "每日總覽";
const SOURCE_ITEM_ANALYSIS_SHEET = "品項分析";
const SOURCE_MONTH_SUMMARY_SHEET = "月總表";

function formatBusinessDate(value: Date | string | null | undefined) {
  const date = value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIPEI_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function todayIsoDate() {
  return formatBusinessDate(new Date());
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

function normalizeProductName(name: string) {
  return name.trim();
}

function isTruthyPaid(value: string) {
  const text = value.trim();
  if (!text) return true;
  return !["否", "未付", "未付款", "no", "false"].includes(text.toLowerCase());
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

function calculatePaymentFee(amount: number, paymentMethod: string | null | undefined) {
  const method = (paymentMethod ?? "").trim();
  if (!amount || amount <= 0) return 0;
  if (method === "歐付寶") return Math.max(1, Math.round(amount * 0.0245));
  if (method === "TWQR") return Math.max(1, Math.round(amount * 0.029));
  return 0;
}

async function loadAllSessionsAndItems(supabase: ReturnType<typeof getSupabaseServerClient>) {
  const { data: sessionsData, error: sessionsError } = await supabase
    .from("dining_sessions")
    .select("*")
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

  return { sessions, orderItems };
}

async function loadCashCountForDate(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  businessDate: string
) {
  const { data, error } = await supabase
    .from("daily_cash_counts")
    .select("*")
    .eq("business_date", businessDate)
    .maybeSingle();

  if (error) {
    const maybeMessage = (error as { message?: string }).message ?? "";
    if (!maybeMessage.includes("daily_cash_counts")) throw error;
    return null;
  }

  return (data as CashCountRow | null) ?? null;
}

async function loadProductCosts(sourceSpreadsheetId: string) {
  const rows = await readSheetValues(SOURCE_PRODUCT_COST_SHEET, sourceSpreadsheetId);
  const headerIndex = findHeaderRowIndex(rows, ["品項名稱", "類別", "售價", "單位成本"]);
  const items: ProductCostItem[] = [];

  if (headerIndex >= 0) {
    const headers = rows[headerIndex];
    for (const row of rows.slice(headerIndex + 1)) {
      const mapped = mapRowByHeader(headers, row);
      const name = normalizeProductName(mapped.get("品項名稱") ?? "");
      if (!name) continue;
      items.push({
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

  return items;
}

async function loadFixedExpenses(sourceSpreadsheetId: string) {
  const rows = await readSheetValues(SOURCE_FIXED_EXPENSE_SHEET, sourceSpreadsheetId);
  const headerIndex = findHeaderRowIndex(rows, ["日期", "月份", "支出項目", "類型", "金額"]);
  const items: FixedExpenseRow[] = [];

  if (headerIndex >= 0) {
    const headers = rows[headerIndex];
    for (const row of rows.slice(headerIndex + 1)) {
      const mapped = mapRowByHeader(headers, row);
      const date = mapped.get("日期") ?? "";
      const month = mapped.get("月份") ?? (date ? String(date).slice(0, 7) : "");
      const item = mapped.get("支出項目") ?? "";
      const type = mapped.get("類型") ?? "";
      const amount = toNumber(mapped.get("金額"));
      if (!date || !amount) continue;
      items.push({
        date,
        month,
        item,
        type,
        amount,
        isPaid: isTruthyPaid(mapped.get("是否已付款") ?? ""),
        note: mapped.get("備註") ?? "",
      });
    }
  }

  return items;
}

async function loadProcurements(sourceSpreadsheetId: string) {
  const rows = await readSheetValues(SOURCE_PROCUREMENT_SHEET, sourceSpreadsheetId);
  const headerIndex = findHeaderRowIndex(rows, ["日期", "月份", "品項", "類型", "總金額"]);
  const items: ProcurementRow[] = [];

  if (headerIndex >= 0) {
    const headers = rows[headerIndex];
    for (const row of rows.slice(headerIndex + 1)) {
      const mapped = mapRowByHeader(headers, row);
      const date = mapped.get("日期") ?? "";
      const month = mapped.get("月份") ?? (date ? String(date).slice(0, 7) : "");
      const totalAmount = toNumber(mapped.get("總金額"));
      if (!date || !totalAmount) continue;
      items.push({
        date,
        month,
        item: mapped.get("品項") ?? "",
        type: mapped.get("類型") ?? "",
        unitPrice: toNumber(mapped.get("單價")),
        quantity: toNumber(mapped.get("數量")),
        totalAmount,
        supplier: mapped.get("供應商") ?? "",
        note: mapped.get("備註") ?? "",
      });
    }
  }

  return items;
}

function buildItemProfitSummary(orderItems: OrderItemRow[], productCosts: ProductCostItem[]) {
  const productCostMap = new Map(productCosts.map((item) => [normalizeProductName(item.name), item]));
  const summary = new Map<string, ItemProfitSummary>();

  for (const item of orderItems.filter((entry) => entry.status === "active")) {
    const productName = normalizeProductName(item.product_name ?? "");
    if (!productName) continue;

    const costInfo = productCostMap.get(productName);
    const quantity = Number(item.quantity ?? 0);
    const salesAmount = Number(item.line_total ?? 0);
    const estimatedCost = quantity * Number(costInfo?.unitCost ?? 0);
    const grossProfit = salesAmount - estimatedCost;

    const existing = summary.get(productName) ?? {
      category: costInfo?.category ?? "",
      quantity: 0,
      salesAmount: 0,
      unitCost: Number(costInfo?.unitCost ?? 0),
      estimatedCost: 0,
      grossProfit: 0,
      grossMargin: costInfo?.grossMargin ?? "",
      featured: costInfo?.featured ?? "",
      notes: costInfo?.notes ?? "",
    };

    existing.quantity += quantity;
    existing.salesAmount += salesAmount;
    existing.estimatedCost += estimatedCost;
    existing.grossProfit += grossProfit;
    summary.set(productName, existing);
  }

  return summary;
}

function sumBy<T>(items: T[], predicate: (item: T) => boolean, value: (item: T) => number) {
  return items.reduce((sum, item) => (predicate(item) ? sum + value(item) : sum), 0);
}

function buildPaymentSummary(sessions: SessionRow[]) {
  const summary = new Map<
    string,
    { count: number; grossAmount: number; feeAmount: number; netAmount: number }
  >();

  for (const session of sessions) {
    const method = session.payment_method?.trim() || "未填付款方式";
    const grossAmount = Number(session.total_amount ?? 0);
    const feeAmount = calculatePaymentFee(grossAmount, method);
    const existing = summary.get(method) ?? {
      count: 0,
      grossAmount: 0,
      feeAmount: 0,
      netAmount: 0,
    };
    existing.count += 1;
    existing.grossAmount += grossAmount;
    existing.feeAmount += feeAmount;
    existing.netAmount += grossAmount - feeAmount;
    summary.set(method, existing);
  }

  return summary;
}

function buildDailyMetric(
  date: string,
  sessions: SessionRow[],
  orderItems: OrderItemRow[],
  productCosts: ProductCostItem[],
  fixedExpenses: FixedExpenseRow[],
  cashCount: CashCountRow | null
): DailyMetric {
  const paidSessions = sessions.filter((session) => session.payment_status === "paid");
  const activeOrderItems = orderItems.filter((item) => item.status === "active");
  const complimentary = sumBy(activeOrderItems, (item) => Boolean(item.is_complimentary), (item) =>
    Number(item.line_total ?? 0)
  );
  const paymentSummary = buildPaymentSummary(paidSessions);
  const paymentFees = Array.from(paymentSummary.values()).reduce((sum, item) => sum + item.feeAmount, 0);
  const productRevenue = paidSessions.reduce(
    (sum, session) => sum + Number(session.subtotal_amount ?? session.total_amount ?? 0),
    0
  );
  const discount = paidSessions.reduce((sum, session) => sum + Number(session.discount_amount ?? 0), 0);
  const tip = paidSessions.reduce((sum, session) => sum + Number(session.tip_amount ?? 0), 0);
  const actualReceived = paidSessions.reduce((sum, session) => sum + Number(session.total_amount ?? 0), 0);
  const cashIncome = sumBy(
    paidSessions,
    (session) => (session.payment_method ?? "") === "現金",
    (session) => Number(session.total_amount ?? 0)
  );
  const transferIncome = sumBy(
    paidSessions,
    (session) => (session.payment_method ?? "") === "歐付寶",
    (session) => Number(session.total_amount ?? 0)
  );
  const otherIncome = paidSessions.reduce((sum, session) => {
    const method = session.payment_method ?? "";
    if (method === "現金" || method === "歐付寶") return sum;
    return sum + Number(session.total_amount ?? 0);
  }, 0);
  const itemSummary = buildItemProfitSummary(activeOrderItems, productCosts);
  const productCost = Array.from(itemSummary.values()).reduce((sum, item) => sum + item.estimatedCost, 0);
  const paidFixedExpenses = fixedExpenses.filter((item) => item.date === date && item.isPaid);
  const rent = paidFixedExpenses.reduce((sum, item) => {
    const joined = `${item.type} ${item.item}`;
    return joined.includes("場租") ? sum + item.amount : sum;
  }, 0);
  const reconciliationDiff =
    cashCount?.closing_cash != null
      ? Number(cashCount.closing_cash) - (Number(cashCount.opening_cash ?? 0) + cashIncome)
      : "";

  return {
    date,
    month: date.slice(0, 7),
    guestCount: sessions.reduce((sum, session) => sum + Number(session.guest_count ?? 0), 0),
    productRevenue,
    cashIncome,
    transferIncome,
    otherIncome,
    tip,
    discount,
    complimentary,
    refund: 0,
    actualReceived,
    productCost,
    grossProfit: actualReceived - productCost - paymentFees,
    paymentFees,
    reconciliationDiff,
    rent,
  };
}

function buildMonthlyMetrics(
  dailyMetrics: DailyMetric[],
  fixedExpenses: FixedExpenseRow[],
  procurements: ProcurementRow[]
) {
  const monthMap = new Map<string, MonthlyMetric>();

  for (const day of dailyMetrics) {
    const existing = monthMap.get(day.month) ?? {
      month: day.month,
      guestCount: 0,
      productRevenue: 0,
      tip: 0,
      otherIncome: 0,
      discount: 0,
      complimentary: 0,
      refund: 0,
      actualReceived: 0,
      productCost: 0,
      procurementCost: 0,
      fixedExpense: 0,
      rent: 0,
      paymentFees: 0,
      netIncome: 0,
      netCashFlow: 0,
    };
    existing.guestCount += day.guestCount;
    existing.productRevenue += day.productRevenue;
    existing.tip += day.tip;
    existing.otherIncome += day.transferIncome + day.otherIncome;
    existing.discount += day.discount;
    existing.complimentary += day.complimentary;
    existing.refund += day.refund;
    existing.actualReceived += day.actualReceived;
    existing.productCost += day.productCost;
    existing.rent += day.rent;
    existing.paymentFees += day.paymentFees;
    monthMap.set(day.month, existing);
  }

  for (const expense of fixedExpenses.filter((item) => item.isPaid)) {
    const existing = monthMap.get(expense.month) ?? {
      month: expense.month,
      guestCount: 0,
      productRevenue: 0,
      tip: 0,
      otherIncome: 0,
      discount: 0,
      complimentary: 0,
      refund: 0,
      actualReceived: 0,
      productCost: 0,
      procurementCost: 0,
      fixedExpense: 0,
      rent: 0,
      paymentFees: 0,
      netIncome: 0,
      netCashFlow: 0,
    };
    const joined = `${expense.type} ${expense.item}`;
    if (joined.includes("場租")) existing.rent += expense.amount;
    else existing.fixedExpense += expense.amount;
    monthMap.set(expense.month, existing);
  }

  for (const purchase of procurements) {
    const existing = monthMap.get(purchase.month) ?? {
      month: purchase.month,
      guestCount: 0,
      productRevenue: 0,
      tip: 0,
      otherIncome: 0,
      discount: 0,
      complimentary: 0,
      refund: 0,
      actualReceived: 0,
      productCost: 0,
      procurementCost: 0,
      fixedExpense: 0,
      rent: 0,
      paymentFees: 0,
      netIncome: 0,
      netCashFlow: 0,
    };
    existing.procurementCost += purchase.totalAmount;
    monthMap.set(purchase.month, existing);
  }

  const months = Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month));
  for (const month of months) {
    month.netIncome =
      month.actualReceived -
      month.productCost -
      month.procurementCost -
      month.fixedExpense -
      month.rent -
      month.paymentFees;
    month.netCashFlow =
      month.actualReceived - month.procurementCost - month.fixedExpense - month.rent;
  }

  return months;
}

async function syncSourceTemplateSheets(
  dailyMetrics: DailyMetric[],
  itemSummary: Map<string, ItemProfitSummary>,
  monthlyMetrics: MonthlyMetric[],
  productCosts: ProductCostItem[],
  fixedExpenses: FixedExpenseRow[],
  procurements: ProcurementRow[]
) {
  const sortedDailyMetrics = [...dailyMetrics].sort((a, b) => a.date.localeCompare(b.date));

  await replaceSheetRangeValues(
    SOURCE_DAILY_OVERVIEW_SHEET,
    "A3:Q400",
    "A3",
    [
      [
        "日期",
        "月份",
        "客人數",
        "商品營業額",
        "現金收入",
        "轉帳收入",
        "其他收入",
        "小費",
        "折扣",
        "招待/未收",
        "退款",
        "實收金額",
        "商品成本",
        "當日毛利",
        "對帳差異",
        "場租",
      ],
      ...sortedDailyMetrics.map((item) => [
        item.date,
        item.month,
        item.guestCount,
        item.productRevenue,
        item.cashIncome,
        item.transferIncome,
        item.otherIncome,
        item.tip,
        item.discount,
        item.complimentary,
        item.refund,
        item.actualReceived,
        item.productCost,
        item.grossProfit,
        item.reconciliationDiff,
        item.rent,
      ]),
    ],
  );

  const rankedItems = Array.from(itemSummary.entries())
    .map(([name, item]) => ({ name, ...item }))
    .sort((a, b) => b.grossProfit - a.grossProfit || b.quantity - a.quantity);
  const topProfitItem = rankedItems[0]?.name ?? "尚無資料";
  const topSalesItem =
    [...rankedItems].sort((a, b) => b.quantity - a.quantity || b.salesAmount - a.salesAmount)[0]?.name ??
    "尚無資料";

  await replaceSheetRangeValues(
    SOURCE_ITEM_ANALYSIS_SHEET,
    "A3:L400",
    "A3",
    [
      ["最賺品項", "", topProfitItem, "", "最熱銷品項", "", topSalesItem],
      [],
      [
        "品項名稱",
        "類別",
        "售價",
        "單位成本",
        "銷售數量",
        "商品營業額",
        "商品成本",
        "毛利",
        "毛利率",
        "是否主打",
        "毛利排名",
        "建議",
      ],
      ...rankedItems.map((item, index) => {
        const costInfo = productCosts.find((product) => normalizeProductName(product.name) === item.name);
        const suggestion = item.quantity === 0 ? "待觀察" : item.grossProfit > 0 ? "主力商品" : "待調整";
        return [
          item.name,
          item.category,
          costInfo?.price ?? 0,
          item.unitCost,
          item.quantity,
          item.salesAmount,
          item.estimatedCost,
          item.grossProfit,
          item.grossMargin === "" ? "" : item.grossMargin,
          costInfo?.featured ?? "",
          index + 1,
          suggestion,
        ];
      }),
    ],
  );

  const currentYear = todayIsoDate().slice(0, 4);
  const yearRows: (string | number)[][] = [];
  for (let month = 1; month <= 12; month += 1) {
    const key = `${currentYear}-${String(month).padStart(2, "0")}`;
    const existing = monthlyMetrics.find((item) => item.month === key);
    yearRows.push([
      key,
      existing?.guestCount ?? "-",
      existing?.productRevenue ?? "-",
      existing?.tip ?? "-",
      existing?.otherIncome ?? "-",
      existing?.discount ?? "-",
      existing?.complimentary ?? "-",
      existing?.refund ?? "-",
      existing?.actualReceived ?? "-",
      existing?.productCost ?? "-",
      existing?.procurementCost ?? "-",
      existing?.fixedExpense ?? "-",
      existing?.rent ?? "-",
      existing?.netIncome ?? "-",
      existing?.netCashFlow ?? "-",
    ]);
  }

  const yearlyRent = fixedExpenses
    .filter((item) => item.month.startsWith(currentYear) && item.isPaid)
    .reduce((sum, item) => {
      const joined = `${item.type} ${item.item}`;
      return joined.includes("場租") ? sum + item.amount : sum;
    }, 0);
  const yearlyFixedExpense = fixedExpenses
    .filter((item) => item.month.startsWith(currentYear) && item.isPaid)
    .reduce((sum, item) => {
      const joined = `${item.type} ${item.item}`;
      return joined.includes("場租") ? sum : sum + item.amount;
    }, 0);
  const yearlyProcurement = procurements
    .filter((item) => item.month.startsWith(currentYear))
    .reduce((sum, item) => sum + item.totalAmount, 0);
  const yearlyActualReceived = monthlyMetrics
    .filter((item) => item.month.startsWith(currentYear))
    .reduce((sum, item) => sum + item.actualReceived, 0);
  const yearlyNetIncome = monthlyMetrics
    .filter((item) => item.month.startsWith(currentYear))
    .reduce((sum, item) => sum + item.netIncome, 0);

  await replaceSheetRangeValues(
    SOURCE_MONTH_SUMMARY_SHEET,
    "A2:O40",
    "A2",
    [
      ["年份", currentYear, "", "本年度場租累計", yearlyRent],
      ["", "", "", "累計固定/其他支出", yearlyFixedExpense],
      ["", "", "", "累計進貨/耗材支出", yearlyProcurement],
      ["", "", "", "累計實收", yearlyActualReceived],
      ["", "", "", "累計淨收入", yearlyNetIncome],
      [],
      [
        "月份",
        "客人數",
        "商品營業額",
        "小費",
        "其他收入",
        "折扣",
        "招待/未收",
        "退款",
        "實收金額",
        "商品成本(依銷售)",
        "進貨/耗材支出",
        "固定/其他支出",
        "場租",
        "淨收入",
        "淨現金流",
      ],
      ...yearRows,
    ],
  );
}

export async function syncTodayDashboardToGoogleSheets() {
  const supabase = getSupabaseServerClient();
  const sourceSpreadsheetId = getCostSpreadsheetId();
  const businessDate = todayIsoDate();

  const { sessions: allSessions, orderItems: allOrderItems } = await loadAllSessionsAndItems(supabase);
  const cashCount = await loadCashCountForDate(supabase, businessDate);

  const availableSheets = sourceSpreadsheetId ? await listSheetTitles(sourceSpreadsheetId) : [];
  const productCosts = sourceSpreadsheetId ? await loadProductCosts(sourceSpreadsheetId) : [];
  const fixedExpenses = sourceSpreadsheetId ? await loadFixedExpenses(sourceSpreadsheetId) : [];
  const procurements = sourceSpreadsheetId ? await loadProcurements(sourceSpreadsheetId) : [];

  const sessions = allSessions.filter(
    (session) => formatBusinessDate(session.created_at ?? "") === businessDate
  );
  const sessionIds = new Set(sessions.map((session) => session.id));
  const orderItems = allOrderItems.filter((item) => sessionIds.has(item.session_id));

  const dailySessionDates = Array.from(
    new Set(allSessions.map((session) => formatBusinessDate(session.created_at ?? "")))
  ).sort();

  const dailyMetrics: DailyMetric[] = [];
  for (const date of dailySessionDates) {
    const daySessions = allSessions.filter(
      (session) => formatBusinessDate(session.created_at ?? "") === date
    );
    const dayIds = new Set(daySessions.map((session) => session.id));
    const dayItems = allOrderItems.filter((item) => dayIds.has(item.session_id));
    const dayCashCount = date === businessDate ? cashCount : null;
    dailyMetrics.push(buildDailyMetric(date, daySessions, dayItems, productCosts, fixedExpenses, dayCashCount));
  }

  const todayMetric =
    dailyMetrics.find((item) => item.date === businessDate) ??
    buildDailyMetric(businessDate, sessions, orderItems, productCosts, fixedExpenses, cashCount);

  const paidSessions = sessions.filter((session) => session.payment_status === "paid");
  const paymentSummary = buildPaymentSummary(paidSessions);
  const totalPaymentFees = Array.from(paymentSummary.values()).reduce(
    (sum, item) => sum + item.feeAmount,
    0
  );
  const netRevenue = todayMetric.actualReceived - totalPaymentFees;
  const todayItemSummary = buildItemProfitSummary(orderItems, productCosts);
  const allItemSummary = buildItemProfitSummary(allOrderItems, productCosts);
  const monthlyMetrics = buildMonthlyMetrics(dailyMetrics, fixedExpenses, procurements);

  const allPaidSessions = allSessions.filter((session) => session.payment_status === "paid");
  const allRevenue = allPaidSessions.reduce((sum, session) => sum + Number(session.total_amount ?? 0), 0);
  const allGuests = allSessions.reduce((sum, session) => sum + Number(session.guest_count ?? 0), 0);
  const allPaymentSummary = buildPaymentSummary(allPaidSessions);
  const allPaymentFees = Array.from(allPaymentSummary.values()).reduce(
    (sum, item) => sum + item.feeAmount,
    0
  );
  const allNetRevenue = allRevenue - allPaymentFees;
  const allEstimatedCost = Array.from(allItemSummary.values()).reduce(
    (sum, item) => sum + item.estimatedCost,
    0
  );
  const fixedExpenseTotal = fixedExpenses
    .filter((item) => item.isPaid)
    .reduce((sum, item) => sum + item.amount, 0);
  const cumulativeProfit = allNetRevenue - allEstimatedCost - fixedExpenseTotal;
  const allGrossProfit = allRevenue - allEstimatedCost;
  const allGrossMargin = allRevenue > 0 ? allGrossProfit / allRevenue : "";

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
        todayMetric.productRevenue,
        todayMetric.guestCount,
        sessions.length,
        paidSessions.length,
        sessions.length - paidSessions.length,
        paidSessions.length > 0 ? Math.round(todayMetric.actualReceived / paidSessions.length) : 0,
        todayMetric.complimentary,
        todayMetric.cashIncome,
        totalPaymentFees,
        netRevenue,
        todayMetric.productCost,
        todayMetric.grossProfit,
        todayMetric.actualReceived > 0 ? todayMetric.grossProfit / todayMetric.actualReceived : "",
        cashCount?.opening_cash ?? "",
        cashCount?.closing_cash ?? "",
        Number(cashCount?.opening_cash ?? 0) + todayMetric.cashIncome,
        todayMetric.reconciliationDiff,
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
        todayMetric.cashIncome,
        Number(cashCount?.opening_cash ?? 0) + todayMetric.cashIncome,
        todayMetric.reconciliationDiff,
        new Date().toISOString(),
      ],
    ]
  );

  await mergeRowsByKey(
    "訂單明細",
    ["主單ID", "營業日期", "主單編號", "建立時間", "來客數", "訂單狀態", "付款狀態", "付款方式", "餐點小計", "折扣金額", "總計金額", "客人類型", "客人標記"],
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

  await replaceSheetValues("品項成本", [
    ["品項名稱", "類別", "售價", "單位成本", "單杯/份毛利", "單杯/份毛利率", "是否主打", "備註"],
    ...productCosts.map((item) => [item.name, item.category, item.price, item.unitCost, item.grossProfit, item.grossMargin, item.featured, item.notes]),
  ]);

  await replaceSheetValues("品項毛利", [
    ["品項名稱", "類別", "今日售出杯數", "今日銷售額", "單位成本", "估算總成本", "估算毛利", "參考毛利率", "備註"],
    ...Array.from(todayItemSummary.entries()).map(([productName, item]) => [productName, item.category, item.quantity, item.salesAmount, item.unitCost, item.estimatedCost, item.grossProfit, item.grossMargin, item.notes]),
  ]);

  await mergeRowsByKey(
    "每日毛利",
    ["營業日期", "今日營業額", "估算餐點成本", "估算毛利", "估算毛利率", "金流手續費", "淨收入", "同步時間"],
    [[businessDate, todayMetric.actualReceived, todayMetric.productCost, todayMetric.grossProfit, todayMetric.actualReceived > 0 ? todayMetric.grossProfit / todayMetric.actualReceived : "", totalPaymentFees, netRevenue, new Date().toISOString()]]
  );

  await replaceSheetValues("付款方式淨收入", [
    ["付款方式", "今日筆數", "今日收款", "手續費", "淨收入"],
    ...Array.from(paymentSummary.entries()).map(([method, item]) => [method, item.count, item.grossAmount, item.feeAmount, item.netAmount]),
  ]);

  await replaceSheetValues("累積損益", [
    ["項目", "數值"],
    ["累積營業收入", allRevenue],
    ["累積金流手續費", allPaymentFees],
    ["累積淨收入", allNetRevenue],
    ["累積估算餐點成本", allEstimatedCost],
    ["累積固定支出", fixedExpenseTotal],
    ["累積估算毛利", allGrossProfit],
    ["累積損益", cumulativeProfit],
    ["累積訂單數", allSessions.length],
    ["累積來客數", allGuests],
    ["累積毛利率", allGrossMargin === "" ? "" : allGrossMargin],
    ["同步時間", new Date().toISOString()],
  ]);

  await replaceSheetValues("成本同步說明", [
    ["項目", "內容"],
    ["來源試算表", sourceSpreadsheetId || "尚未設定 GOOGLE_COST_SOURCE_SPREADSHEET_ID"],
    ["已掃描分頁", availableSheets.join("、") || "未提供來源成本表"],
    ["目前手續費規則", "歐付寶 2.45% / 每筆最低 1 元；現金與其他先視為 0 元"],
  ]);

  await syncSourceTemplateSheets(dailyMetrics, allItemSummary, monthlyMetrics, productCosts, fixedExpenses, procurements);

  return {
    businessDate,
    revenue: todayMetric.actualReceived,
    guests: todayMetric.guestCount,
    sessions: sessions.length,
    cashRevenue: todayMetric.cashIncome,
    totalPaymentFees,
    netRevenue,
    costItems: productCosts.length,
    cumulativeProfit,
  };
}
