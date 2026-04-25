import { createClient } from "@supabase/supabase-js";
import {
  batchUpdateSpreadsheet,
  getEmbeddedChartIdsByTitle,
  getSheetIdByTitle,
  listSheetTitles,
  mergeRowsByKey,
  readSheetValues,
  replaceSheetRangeValues,
  replaceSheetValues,
  setSheetHidden,
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
  paid_at?: string | null;
  amount_received?: number | null;
  change_amount?: number | null;
};

type OrderItemRow = {
  id: string;
  session_id: string;
  product_name: string;
  unit_price?: number | null;
  quantity: number;
  line_total: number;
  status: string;
  is_complimentary?: boolean | null;
  is_served?: boolean | null;
  created_at?: string | null;
};

type SessionPaymentSplitRow = {
  id: string;
  session_id: string;
  split_label?: string | null;
  payment_method: string;
  amount: number;
  amount_received?: number | null;
  change_amount?: number | null;
  sort_order: number;
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

type ManualDailyReportRow = {
  business_date: string;
  guest_count: number | null;
  product_revenue: number | null;
  cash_income: number | null;
  transfer_income: number | null;
  other_income: number | null;
  tip_amount: number | null;
  discount_amount: number | null;
  complimentary_amount: number | null;
  refund_amount: number | null;
  product_cost: number | null;
  reconciliation_diff: number | null;
  rent_amount: number | null;
  notes?: string | null;
};

type ManualDailyProductSaleRow = {
  business_date: string;
  product_name: string;
  quantity: number | null;
  sales_amount: number | null;
  notes?: string | null;
};

type ManualSessionDetailRow = {
  id: string;
  business_date: string;
  session_number: string;
  created_at?: string | null;
  paid_at?: string | null;
  guest_count: number | null;
  order_status: string | null;
  payment_status: string | null;
  payment_method?: string | null;
  subtotal_amount?: number | null;
  discount_amount?: number | null;
  total_amount: number | null;
  customer_type?: string | null;
  customer_label?: string | null;
  stay_minutes?: number | null;
};

type ProductPriceHistoryRow = {
  effective_from: string;
  price: number;
  note?: string | null;
  product?: {
    name?: string | null;
  } | null;
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
  shippingFee: number;
  totalAmount: number;
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
  shippingFee: number;
  totalAmount: number;
  supplier: string;
  note: string;
};

type ManualProcurementRow = {
  purchase_date: string;
  item_name: string;
  type: string;
  unit_price: number | null;
  quantity: number | null;
  shipping_fee: number | null;
  supplier?: string | null;
  note?: string | null;
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

type SalesDetailRow = {
  businessDate: string;
  month: string;
  sessionNumber: string;
  productName: string;
  category: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  salesAmount: number;
  productCost: number;
  grossProfit: number;
  discountAmount: number;
  complimentaryAmount: number;
  customerType: string;
  note: string;
  paymentMethod: string;
  sortDateTime: string;
  orderGroup: string;
  sourceType: "live" | "manual";
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

type SheetStyleConfig = {
  title: string;
  frozenRows?: number;
  headerRowIndex?: number;
  currencyColumns?: number[];
  percentColumns?: number[];
  dateColumns?: number[];
  autoResizeColumnCount?: number;
  headerRowHeight?: number;
  bodyRowHeight?: number;
  columnWidths?: Array<number | null | undefined>;
  customRowHeights?: Array<{ rowIndex: number; pixelSize: number }>;
  leftAlignColumns?: number[];
  centerAlignColumns?: number[];
  rightAlignColumns?: number[];
  columnBackgrounds?: Array<{
    columns: number[];
    color: { red: number; green: number; blue: number };
  }>;
  customNumberFormats?: Array<{
    startRowIndex: number;
    endRowIndex: number;
    columnIndex: number;
    type: "NUMBER" | "PERCENT" | "CURRENCY";
    pattern: string;
  }>;
};

function normalizeMonthValue(value: string | null | undefined) {
  const raw = String(value ?? "").replace(/^'/, "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})/);
  if (!match) return raw;
  return `${match[1]}-${match[2]}`;
}

function buildMonthlyOrderSheetTitle(month: string) {
  const normalized = normalizeMonthValue(month);
  if (!/^\d{4}-\d{2}$/.test(normalized)) return "";
  return `${normalized.slice(2)}訂單明細`;
}

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

const PRODUCT_NAME_ALIASES = new Map<string, string>([
  ["咖啡歐蕾", "日式咖啡歐蕾"],
  ["微醺奶茶舊版", "微醺奶茶"],
]);

function normalizeProductName(name: string) {
  const normalized = name.trim().replace(/\s+/g, " ");
  return PRODUCT_NAME_ALIASES.get(normalized) ?? normalized;
}

function buildSalesDetailRows(
  sessions: SessionRow[],
  orderItems: OrderItemRow[],
  manualProductSales: ManualDailyProductSaleRow[],
  productCosts: ProductCostItem[],
  paymentSplits: SessionPaymentSplitRow[]
) {
  const productCostMap = new Map(
      productCosts.map((item) => [normalizeProductName(item.name), item])
    );
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));
  const splitMap = new Map<string, SessionPaymentSplitRow[]>();
  for (const split of paymentSplits) {
    const current = splitMap.get(split.session_id) ?? [];
    current.push(split);
    splitMap.set(split.session_id, current);
  }
  const complimentaryTotalsBySession = new Map<string, number>();

  for (const item of orderItems) {
    if (!item.is_complimentary) continue;
    complimentaryTotalsBySession.set(
      item.session_id,
      (complimentaryTotalsBySession.get(item.session_id) ?? 0) + Number(item.line_total ?? 0)
    );
  }

  const liveRows = orderItems.reduce<SalesDetailRow[]>((rows, item) => {
    const session = sessionMap.get(item.session_id);
    if (!session) return rows;

    const product = productCostMap.get(normalizeProductName(item.product_name));
    const quantity = Number(item.quantity ?? 0);
    const salesAmount = Number(item.line_total ?? 0);
    const unitPrice =
      quantity > 0 ? Math.round((salesAmount / quantity) * 100) / 100 : Number(product?.price ?? 0);
    const unitCost = Number(product?.unitCost ?? 0);
    const productCost = quantity * unitCost;
    const sessionSplits = splitMap.get(session.id) ?? [];
    const paymentMethod =
      sessionSplits.length > 0
        ? sessionSplits
            .map((split) => `${split.payment_method}${split.amount ? ` ${split.amount}` : ""}`)
            .join(" / ")
        : session.payment_method?.trim() || "";

    rows.push({
      businessDate: formatBusinessDate(session.created_at ?? ""),
      month: `'${formatBusinessDate(session.created_at ?? "").slice(0, 7)}`,
      sessionNumber: session.session_number,
      productName: item.product_name,
      category: product?.category ?? "",
      quantity,
      unitPrice,
      unitCost,
      salesAmount,
      productCost,
      grossProfit: salesAmount - productCost,
      discountAmount: Number(session.discount_amount ?? 0),
      complimentaryAmount: complimentaryTotalsBySession.get(session.id) ?? 0,
      customerType: session.customer_type ?? "",
      note: session.customer_label ?? session.session_number,
      paymentMethod,
      sortDateTime: session.created_at ?? session.session_number,
      orderGroup: session.session_number,
      sourceType: "live",
    });

    return rows;
  }, []);

  const manualRows: SalesDetailRow[] = manualProductSales.map((item) => {
    const product = productCostMap.get(normalizeProductName(item.product_name));
    const quantity = Number(item.quantity ?? 0);
    const salesAmount = Number(item.sales_amount ?? 0);
    const unitPrice =
      quantity > 0 ? Math.round((salesAmount / quantity) * 100) / 100 : Number(product?.price ?? 0);
    const unitCost = Number(product?.unitCost ?? 0);
    const productCost = quantity * unitCost;

    return {
      businessDate: item.business_date,
      month: `'${item.business_date.slice(0, 7)}`,
      sessionNumber: "歷史補登",
      productName: item.product_name,
      category: product?.category ?? "",
      quantity,
      unitPrice,
      unitCost,
      salesAmount,
      productCost,
      grossProfit: salesAmount - productCost,
      discountAmount: 0,
      complimentaryAmount: 0,
      customerType: "",
      note: item.notes ?? "",
      paymentMethod: "",
        sortDateTime: item.business_date,
        orderGroup: item.notes ?? item.product_name,
        sourceType: "manual",
      };
    });

    return [...liveRows, ...manualRows].sort((a, b) => {
      const dateCompare = a.businessDate.localeCompare(b.businessDate);
      if (dateCompare !== 0) return dateCompare;
      const sourceCompare = a.sourceType.localeCompare(b.sourceType);
      if (sourceCompare !== 0) return sourceCompare;
      const timeCompare = a.sortDateTime.localeCompare(b.sortDateTime);
      if (timeCompare !== 0) return timeCompare;
      const groupCompare = a.orderGroup.localeCompare(b.orderGroup, "zh-Hant");
      if (groupCompare !== 0) return groupCompare;
      return a.productName.localeCompare(b.productName, "zh-Hant");
    });
  }

function columnToLetter(columnNumber: number) {
  let current = columnNumber;
  let result = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

function calculateStayMinutes(
  createdAt: string | null | undefined,
  paidAt: string | null | undefined,
  paymentStatus?: string | null,
  manualStayMinutes?: number | null
) {
  if (manualStayMinutes != null && Number.isFinite(Number(manualStayMinutes))) {
    return Math.max(0, Math.round(Number(manualStayMinutes)));
  }

  if (!createdAt) return "";
  const start = new Date(createdAt);
  if (Number.isNaN(start.getTime())) return "";

  const endValue = paidAt || (paymentStatus === "paid" ? createdAt : null);
  if (!endValue) return "";
  const end = new Date(endValue);
  if (Number.isNaN(end.getTime())) return "";

  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
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

async function loadAllCashCounts(supabase: ReturnType<typeof getSupabaseServerClient>) {
  const { data, error } = await supabase
    .from("daily_cash_counts")
    .select("*")
    .order("business_date", { ascending: true });

  if (error) {
    const maybeMessage = (error as { message?: string }).message ?? "";
    if (maybeMessage.includes("daily_cash_counts")) {
      return [] as CashCountRow[];
    }
    throw error;
  }

  return (data ?? []) as CashCountRow[];
}

async function loadManualDailyReports(supabase: ReturnType<typeof getSupabaseServerClient>) {
  const { data, error } = await supabase
    .from("manual_daily_reports")
    .select("*")
    .order("business_date", { ascending: true });

  if (error) {
    const maybeMessage = (error as { message?: string }).message ?? "";
    if (maybeMessage.includes("manual_daily_reports")) {
      return [] as ManualDailyReportRow[];
    }
    throw error;
  }

  return (data ?? []) as ManualDailyReportRow[];
}

async function loadManualDailyProductSales(supabase: ReturnType<typeof getSupabaseServerClient>) {
  const { data, error } = await supabase
    .from("manual_daily_product_sales")
    .select("*")
    .order("business_date", { ascending: true })
    .order("product_name", { ascending: true });

  if (error) {
    const maybeMessage = (error as { message?: string }).message ?? "";
    if (maybeMessage.includes("manual_daily_product_sales")) {
      return [] as ManualDailyProductSaleRow[];
    }
    throw error;
  }

  return (data ?? []) as ManualDailyProductSaleRow[];
}

async function loadManualSessionDetails(supabase: ReturnType<typeof getSupabaseServerClient>) {
  const { data, error } = await supabase
    .from("manual_session_details")
    .select("*")
    .order("business_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    const maybeMessage = (error as { message?: string }).message ?? "";
    if (maybeMessage.includes("manual_session_details")) {
      return [] as ManualSessionDetailRow[];
    }
    throw error;
  }

  return (data ?? []) as ManualSessionDetailRow[];
}

async function loadSessionPaymentSplits(supabase: ReturnType<typeof getSupabaseServerClient>) {
  const { data, error } = await supabase
    .from("session_payment_splits")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    const maybeMessage = (error as { message?: string }).message ?? "";
    if (maybeMessage.includes("session_payment_splits")) {
      return [] as SessionPaymentSplitRow[];
    }
    throw error;
  }

  return (data ?? []) as SessionPaymentSplitRow[];
}

async function loadManualProcurementsFromDb(supabase: ReturnType<typeof getSupabaseServerClient>) {
  const { data, error } = await supabase
    .from("manual_procurements")
    .select("*")
    .order("purchase_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    const maybeMessage = (error as { message?: string }).message ?? "";
    if (maybeMessage.includes("manual_procurements")) {
      return [] as ManualProcurementRow[];
    }
    throw error;
  }

  return (data ?? []) as ManualProcurementRow[];
}

async function loadProductCosts(sourceSpreadsheetId?: string) {
  const rowsFromReport = await readSheetValues(SOURCE_PRODUCT_COST_SHEET);
  const rowsFromSource =
    rowsFromReport.length === 0 && sourceSpreadsheetId
      ? await readSheetValues(SOURCE_PRODUCT_COST_SHEET, sourceSpreadsheetId)
      : [];
  const rows = rowsFromReport.length > 0 ? rowsFromReport : rowsFromSource;
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

  return {
    items,
    source: rowsFromReport.length > 0 ? "report" : rowsFromSource.length > 0 ? "source" : "none",
    reportRowCount: rowsFromReport.length,
    sourceRowCount: rowsFromSource.length,
  };
}

async function loadProductPriceHistory(supabase: ReturnType<typeof getSupabaseServerClient>) {
  const { data, error } = await supabase
    .from("product_price_history")
    .select("effective_from, price, note, products(name)")
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    if (error.message?.includes("product_price_history")) {
      return [] as Array<{
        effectiveFrom: string;
        productName: string;
        price: number;
        note: string;
      }>;
    }
    throw error;
  }

  return ((data ?? []) as Array<
    ProductPriceHistoryRow & { products?: { name?: string | null } | null }
  >)
    .map((row) => ({
      effectiveFrom: row.effective_from,
      productName: normalizeProductName(row.products?.name ?? row.product?.name ?? ""),
      price: toNumber(row.price),
      note: row.note ?? "",
    }))
    .filter((row) => row.productName);
}

async function loadFixedExpenses(sourceSpreadsheetId?: string) {
  const rowsFromReport = await readSheetValues("固定支出");
  const rowsFromSource =
    rowsFromReport.length === 0 && sourceSpreadsheetId
      ? await readSheetValues(SOURCE_FIXED_EXPENSE_SHEET, sourceSpreadsheetId)
      : [];
  const rows = rowsFromReport.length > 0 ? rowsFromReport : rowsFromSource;
  const headerIndex = findHeaderRowIndex(rows, ["日期", "月份", "支出項目", "類型"]);
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
      const shippingFee = toNumber(mapped.get("運費"));
      const totalAmount = toNumber(mapped.get("總支出")) || amount + shippingFee;
      if (!date || (!amount && !shippingFee && !totalAmount)) continue;
      items.push({
        date,
        month,
        item,
        type,
        amount,
        shippingFee,
        totalAmount,
        isPaid: isTruthyPaid(mapped.get("是否已付款") ?? ""),
        note: mapped.get("備註") ?? "",
      });
    }
  }

  return items;
}

async function loadProcurements(
  manualProcurementRows: ManualProcurementRow[] = [],
  sourceSpreadsheetId?: string
) {
  const rowsFromReport = await readSheetValues("進貨耗材");
  const rowsFromSource =
    rowsFromReport.length === 0 && sourceSpreadsheetId
      ? await readSheetValues(SOURCE_PROCUREMENT_SHEET, sourceSpreadsheetId)
      : [];
  const rows = rowsFromReport.length > 0 ? rowsFromReport : rowsFromSource;
  const headerIndex = findHeaderRowIndex(rows, ["日期", "月份", "品項", "類型"]);
  const items: ProcurementRow[] = [];

  if (headerIndex >= 0) {
    const headers = rows[headerIndex];
    for (const row of rows.slice(headerIndex + 1)) {
      const mapped = mapRowByHeader(headers, row);
      const date = mapped.get("日期") ?? "";
      const month = mapped.get("月份") ?? (date ? String(date).slice(0, 7) : "");
      const unitPrice = toNumber(mapped.get("單價"));
      const quantity = toNumber(mapped.get("數量"));
      const shippingFee = toNumber(mapped.get("運費"));
      const totalAmount = toNumber(mapped.get("總金額")) || unitPrice * quantity + shippingFee;
      if (!date || (!unitPrice && !quantity && !shippingFee && !totalAmount)) continue;
      items.push({
        date,
        month,
        item: mapped.get("品項") ?? "",
        type: mapped.get("類型") ?? "",
        unitPrice,
        quantity,
        shippingFee,
        totalAmount,
        supplier: mapped.get("供應商") ?? "",
        note: mapped.get("備註") ?? "",
      });
    }
  }

  for (const row of manualProcurementRows) {
    const date = row.purchase_date ?? "";
    if (!date) continue;
    const month = date.slice(0, 7);
    const unitPrice = toNumber(row.unit_price);
    const quantity = toNumber(row.quantity);
    const shippingFee = toNumber(row.shipping_fee);
    items.push({
      date,
      month,
      item: row.item_name ?? "",
      type: row.type ?? "",
      unitPrice,
      quantity,
      shippingFee,
      totalAmount: unitPrice * quantity + shippingFee,
      supplier: row.supplier ?? "",
      note: row.note ?? "",
    });
  }

  return items.sort((a, b) => a.date.localeCompare(b.date) || a.item.localeCompare(b.item, "zh-Hant"));
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

function mergeManualProductSalesIntoSummary(
  baseSummary: Map<string, ItemProfitSummary>,
  manualSales: ManualDailyProductSaleRow[],
  productCosts: ProductCostItem[]
) {
  if (manualSales.length === 0) return baseSummary;

  const summary = new Map(baseSummary);
  const productCostMap = new Map(productCosts.map((item) => [normalizeProductName(item.name), item]));

  for (const sale of manualSales) {
    const productName = normalizeProductName(sale.product_name ?? "");
    if (!productName) continue;

    const costInfo = productCostMap.get(productName);
    const quantity = Number(sale.quantity ?? 0);
    const salesAmount = Number(sale.sales_amount ?? 0);
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

function buildPaymentSummary(sessions: SessionRow[], paymentSplits: SessionPaymentSplitRow[] = []) {
  const summary = new Map<
    string,
    { count: number; grossAmount: number; feeAmount: number; netAmount: number }
  >();
  const splitMap = new Map<string, SessionPaymentSplitRow[]>();
  for (const split of paymentSplits) {
    const current = splitMap.get(split.session_id) ?? [];
    current.push(split);
    splitMap.set(split.session_id, current);
  }

  for (const session of sessions) {
    const splits = splitMap.get(session.id) ?? [];
    if (splits.length > 0) {
      for (const split of splits) {
        const method = split.payment_method?.trim() || "未填付款方式";
        const grossAmount = Number(split.amount ?? 0);
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
      continue;
    }

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
  cashCount: CashCountRow | null,
  paymentSplits: SessionPaymentSplitRow[] = []
): DailyMetric {
  const paidSessions = sessions.filter((session) => session.payment_status === "paid");
  const activeOrderItems = orderItems.filter((item) => item.status === "active");
  const complimentary = sumBy(activeOrderItems, (item) => Boolean(item.is_complimentary), (item) =>
    Number(item.line_total ?? 0)
  );
  const paymentSummary = buildPaymentSummary(
    paidSessions,
    paymentSplits.filter((split) => paidSessions.some((session) => session.id === split.session_id))
  );
  const paymentFees = Array.from(paymentSummary.values()).reduce((sum, item) => sum + item.feeAmount, 0);
  const productRevenue = paidSessions.reduce(
    (sum, session) => sum + Number(session.subtotal_amount ?? session.total_amount ?? 0),
    0
  );
  const discount = paidSessions.reduce((sum, session) => sum + Number(session.discount_amount ?? 0), 0);
  const tip = paidSessions.reduce((sum, session) => sum + Number(session.tip_amount ?? 0), 0);
  const actualReceived = paidSessions.reduce((sum, session) => sum + Number(session.total_amount ?? 0), 0);
  const splitMap = new Map<string, SessionPaymentSplitRow[]>();
  for (const split of paymentSplits) {
    const current = splitMap.get(split.session_id) ?? [];
    current.push(split);
    splitMap.set(split.session_id, current);
  }
  let cashIncome = 0;
  let transferIncome = 0;
  let otherIncome = 0;
  for (const session of paidSessions) {
    const splits = splitMap.get(session.id) ?? [];
    if (splits.length > 0) {
      for (const split of splits) {
        const method = split.payment_method ?? "";
        const amount = Number(split.amount ?? 0);
        if (method === "現金") cashIncome += amount;
        else if (method === "歐付寶") transferIncome += amount;
        else otherIncome += amount;
      }
      continue;
    }
    const method = session.payment_method ?? "";
    const amount = Number(session.total_amount ?? 0);
    if (method === "現金") cashIncome += amount;
    else if (method === "歐付寶") transferIncome += amount;
    else otherIncome += amount;
  }
  const itemSummary = buildItemProfitSummary(activeOrderItems, productCosts);
  const productCost = Array.from(itemSummary.values()).reduce((sum, item) => sum + item.estimatedCost, 0);
  const paidFixedExpenses = fixedExpenses.filter((item) => item.date === date && item.isPaid);
  const rent = paidFixedExpenses.reduce((sum, item) => {
    const joined = `${item.type} ${item.item}`;
    return joined.includes("場租") ? sum + item.totalAmount : sum;
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

function mergeManualDailyMetric(
  base: DailyMetric,
  manual: ManualDailyReportRow | undefined
) {
  if (!manual) return base;

  const manualCashIncome = Number(manual.cash_income ?? 0);
  const manualTransferIncome = Number(manual.transfer_income ?? 0);
  const manualOtherIncome = Number(manual.other_income ?? 0);
  const manualTip = Number(manual.tip_amount ?? 0);
  const manualDiscount = Number(manual.discount_amount ?? 0);
  const manualComplimentary = Number(manual.complimentary_amount ?? 0);
  const manualRefund = Number(manual.refund_amount ?? 0);
  const actualReceivedAddition =
    manualCashIncome + manualTransferIncome + manualOtherIncome + manualTip - manualDiscount - manualRefund;
  const productCost = base.productCost + Number(manual.product_cost ?? 0);
  const paymentFees = base.paymentFees;

  return {
    ...base,
    guestCount: base.guestCount + Number(manual.guest_count ?? 0),
    productRevenue: base.productRevenue + Number(manual.product_revenue ?? 0),
    cashIncome: base.cashIncome + manualCashIncome,
    transferIncome: base.transferIncome + manualTransferIncome,
    otherIncome: base.otherIncome + manualOtherIncome,
    tip: base.tip + manualTip,
    discount: base.discount + manualDiscount,
    complimentary: base.complimentary + manualComplimentary,
    refund: base.refund + manualRefund,
    actualReceived: base.actualReceived + actualReceivedAddition,
    productCost,
    grossProfit: base.actualReceived + actualReceivedAddition - productCost - paymentFees,
    reconciliationDiff:
      base.reconciliationDiff === ""
        ? Number(manual.reconciliation_diff ?? 0)
        : Number(base.reconciliationDiff) + Number(manual.reconciliation_diff ?? 0),
    rent: base.rent + Number(manual.rent_amount ?? 0),
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
      return joined.includes("場租") ? sum + item.totalAmount : sum;
    }, 0);
  const yearlyFixedExpense = fixedExpenses
    .filter((item) => item.month.startsWith(currentYear) && item.isPaid)
    .reduce((sum, item) => {
      const joined = `${item.type} ${item.item}`;
      return joined.includes("場租") ? sum : sum + item.totalAmount;
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

async function applySheetStyles(configs: SheetStyleConfig[]) {
  const requests: Record<string, unknown>[] = [];

  for (const config of configs) {
    const sheetId = await getSheetIdByTitle(config.title);
    if (sheetId == null) continue;

    if (config.frozenRows != null) {
      requests.push({
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: {
              frozenRowCount: config.frozenRows,
            },
          },
          fields: "gridProperties.frozenRowCount",
        },
      });
    }

    if (config.headerRowIndex != null) {
      if (config.headerRowHeight != null) {
        requests.push({
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: config.headerRowIndex,
              endIndex: config.headerRowIndex + 1,
            },
            properties: {
              pixelSize: config.headerRowHeight,
            },
            fields: "pixelSize",
          },
        });
      }

      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: config.headerRowIndex,
            endRowIndex: config.headerRowIndex + 1,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: {
                red: 0.11,
                green: 0.29,
                blue: 0.5,
              },
              textFormat: {
                foregroundColor: { red: 1, green: 1, blue: 1 },
                bold: true,
              },
              horizontalAlignment: "CENTER",
            },
          },
          fields:
            "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
        },
      });
    }

    if (config.bodyRowHeight != null) {
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: "ROWS",
            startIndex: (config.headerRowIndex ?? 0) + 1,
            endIndex: 200,
          },
          properties: {
            pixelSize: config.bodyRowHeight,
          },
          fields: "pixelSize",
        },
      });
    }

    for (const rowHeight of config.customRowHeights ?? []) {
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: "ROWS",
            startIndex: rowHeight.rowIndex,
            endIndex: rowHeight.rowIndex + 1,
          },
          properties: {
            pixelSize: rowHeight.pixelSize,
          },
          fields: "pixelSize",
        },
      });
    }

    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: (config.headerRowIndex ?? 0) + 1,
          endRowIndex: 200,
        },
        cell: {
          userEnteredFormat: {
            verticalAlignment: "MIDDLE",
            wrapStrategy: "WRAP",
          },
        },
        fields: "userEnteredFormat(verticalAlignment,wrapStrategy)",
      },
    });

    for (const [columnIndex, pixelSize] of (config.columnWidths ?? []).entries()) {
      if (pixelSize == null) continue;
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: "COLUMNS",
            startIndex: columnIndex,
            endIndex: columnIndex + 1,
          },
          properties: {
            pixelSize,
          },
          fields: "pixelSize",
        },
      });
    }

    for (const group of config.columnBackgrounds ?? []) {
      for (const columnIndex of group.columns) {
        requests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: (config.headerRowIndex ?? 0) + 1,
              endRowIndex: 200,
              startColumnIndex: columnIndex,
              endColumnIndex: columnIndex + 1,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: group.color,
              },
            },
            fields: "userEnteredFormat.backgroundColor",
          },
        });
      }
    }

    for (const columnIndex of config.leftAlignColumns ?? []) {
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: (config.headerRowIndex ?? 0) + 1,
            endRowIndex: 200,
            startColumnIndex: columnIndex,
            endColumnIndex: columnIndex + 1,
          },
          cell: {
            userEnteredFormat: {
              horizontalAlignment: "LEFT",
            },
          },
          fields: "userEnteredFormat.horizontalAlignment",
        },
      });
    }

    for (const columnIndex of config.centerAlignColumns ?? []) {
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: (config.headerRowIndex ?? 0) + 1,
            endRowIndex: 200,
            startColumnIndex: columnIndex,
            endColumnIndex: columnIndex + 1,
          },
          cell: {
            userEnteredFormat: {
              horizontalAlignment: "CENTER",
            },
          },
          fields: "userEnteredFormat.horizontalAlignment",
        },
      });
    }

    for (const columnIndex of config.rightAlignColumns ?? []) {
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: (config.headerRowIndex ?? 0) + 1,
            endRowIndex: 200,
            startColumnIndex: columnIndex,
            endColumnIndex: columnIndex + 1,
          },
          cell: {
            userEnteredFormat: {
              horizontalAlignment: "RIGHT",
            },
          },
          fields: "userEnteredFormat.horizontalAlignment",
        },
      });
    }

    for (const columnIndex of config.currencyColumns ?? []) {
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: (config.headerRowIndex ?? 0) + 1,
            startColumnIndex: columnIndex,
            endColumnIndex: columnIndex + 1,
          },
          cell: {
            userEnteredFormat: {
              numberFormat: {
                type: "CURRENCY",
                pattern: "\"NT$\"#,##0",
              },
            },
          },
          fields: "userEnteredFormat.numberFormat",
        },
      });
    }

    for (const columnIndex of config.percentColumns ?? []) {
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: (config.headerRowIndex ?? 0) + 1,
            startColumnIndex: columnIndex,
            endColumnIndex: columnIndex + 1,
          },
          cell: {
            userEnteredFormat: {
              numberFormat: {
                type: "PERCENT",
                pattern: "0.0%",
              },
            },
          },
          fields: "userEnteredFormat.numberFormat",
        },
      });
    }

      for (const columnIndex of config.dateColumns ?? []) {
        requests.push({
          repeatCell: {
          range: {
            sheetId,
            startRowIndex: (config.headerRowIndex ?? 0) + 1,
            startColumnIndex: columnIndex,
            endColumnIndex: columnIndex + 1,
          },
          cell: {
            userEnteredFormat: {
              numberFormat: {
                type: "DATE",
                pattern: "yyyy-mm-dd",
              },
            },
          },
          fields: "userEnteredFormat.numberFormat",
        },
        });
      }

      for (const format of config.customNumberFormats ?? []) {
        requests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: format.startRowIndex,
              endRowIndex: format.endRowIndex,
              startColumnIndex: format.columnIndex,
              endColumnIndex: format.columnIndex + 1,
            },
            cell: {
              userEnteredFormat: {
                numberFormat: {
                  type: format.type,
                  pattern: format.pattern,
                },
              },
            },
            fields: "userEnteredFormat.numberFormat",
          },
        });
      }

      if (config.autoResizeColumnCount != null && !(config.columnWidths?.length)) {
        requests.push({
        autoResizeDimensions: {
          dimensions: {
            sheetId,
            dimension: "COLUMNS",
            startIndex: 0,
            endIndex: config.autoResizeColumnCount,
          },
        },
      });
    }
  }

  await batchUpdateSpreadsheet(requests);
}

async function applySheetDropdowns() {
  const dropdownConfigs = [
    {
      title: "進貨耗材",
      columnIndex: 3,
      values: ["飲品原料", "食品原料", "包材", "咖啡豆", "雜費"],
    },
    {
      title: "固定支出",
      columnIndex: 3,
      values: ["場租", "設備", "人力"],
    },
  ];

  const requests: Record<string, unknown>[] = [];

  for (const config of dropdownConfigs) {
    const sheetId = await getSheetIdByTitle(config.title);
    if (sheetId == null) continue;

    requests.push({
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: 1000,
          startColumnIndex: config.columnIndex,
          endColumnIndex: config.columnIndex + 1,
        },
        rule: {
          condition: {
            type: "ONE_OF_LIST",
            values: config.values.map((value) => ({ userEnteredValue: value })),
          },
          strict: true,
          showCustomUi: true,
        },
      },
    });
  }

  await batchUpdateSpreadsheet(requests);
}

async function applySheetCharts(itemEntryCount: number, stayEntryCount: number) {
  const requests: Record<string, unknown>[] = [];

  const chartSheets = ["品項分析", "客群停留分析"];
  for (const title of chartSheets) {
    const chartIds = await getEmbeddedChartIdsByTitle(title);
    for (const chartId of chartIds) {
      requests.push({
        deleteEmbeddedObject: {
          objectId: chartId,
        },
      });
    }
  }

  const itemAnalysisSheetId = await getSheetIdByTitle("品項分析");
  if (itemAnalysisSheetId != null && itemEntryCount > 0) {
    requests.push({
      addChart: {
        chart: {
          spec: {
            title: "品項營業額占比",
            pieChart: {
              legendPosition: "RIGHT_LEGEND",
              domain: {
                sourceRange: {
                  sources: [
                    {
                      sheetId: itemAnalysisSheetId,
                      startRowIndex: 5,
                      endRowIndex: itemEntryCount + 5,
                      startColumnIndex: 0,
                      endColumnIndex: 1,
                    },
                  ],
                },
              },
              series: {
                sourceRange: {
                  sources: [
                    {
                      sheetId: itemAnalysisSheetId,
                      startRowIndex: 5,
                      endRowIndex: itemEntryCount + 5,
                      startColumnIndex: 5,
                      endColumnIndex: 6,
                    },
                  ],
                },
              },
              threeDimensional: false,
            },
          },
          position: {
            overlayPosition: {
              anchorCell: {
                sheetId: itemAnalysisSheetId,
                rowIndex: 0,
                columnIndex: 13,
              },
              offsetXPixels: 8,
              offsetYPixels: 8,
              widthPixels: 420,
              heightPixels: 240,
            },
          },
        },
      },
    });
  }

  const staySheetId = await getSheetIdByTitle("客群停留分析");
  if (staySheetId != null && stayEntryCount > 0) {
    requests.push({
      addChart: {
        chart: {
          spec: {
            title: "來客占比圓餅圖",
            pieChart: {
              legendPosition: "RIGHT_LEGEND",
              domain: {
                sourceRange: {
                  sources: [
                    {
                      sheetId: staySheetId,
                      startRowIndex: 1,
                      endRowIndex: stayEntryCount + 1,
                      startColumnIndex: 7,
                      endColumnIndex: 8,
                    },
                  ],
                },
              },
              series: {
                sourceRange: {
                  sources: [
                    {
                      sheetId: staySheetId,
                      startRowIndex: 1,
                      endRowIndex: stayEntryCount + 1,
                      startColumnIndex: 8,
                      endColumnIndex: 9,
                    },
                  ],
                },
              },
              threeDimensional: false,
            },
          },
          position: {
            overlayPosition: {
              anchorCell: {
                sheetId: staySheetId,
                rowIndex: 1,
                columnIndex: 10,
              },
              offsetXPixels: 8,
              offsetYPixels: 8,
              widthPixels: 420,
              heightPixels: 240,
            },
          },
        },
      },
    });
  }

  await batchUpdateSpreadsheet(requests);
}

export async function syncTodayDashboardToGoogleSheets(targetBusinessDate?: string) {
  const supabase = getSupabaseServerClient();
  const sourceSpreadsheetId = getCostSpreadsheetId();
  const businessDate = targetBusinessDate?.trim() || todayIsoDate();

  const { sessions: allSessions, orderItems: allOrderItems } = await loadAllSessionsAndItems(supabase);
  const paymentSplits = await loadSessionPaymentSplits(supabase);
  const cashCount = await loadCashCountForDate(supabase, businessDate);
  const allCashCounts = await loadAllCashCounts(supabase);
  const manualDailyReports = await loadManualDailyReports(supabase);
  const manualProductSales = await loadManualDailyProductSales(supabase);
  const manualSessionDetails = await loadManualSessionDetails(supabase);
  const manualProcurements = await loadManualProcurementsFromDb(supabase);

  const availableSheets = sourceSpreadsheetId ? await listSheetTitles(sourceSpreadsheetId) : [];
  const productCostLoadResult = await loadProductCosts(sourceSpreadsheetId || undefined);
  const productCosts = productCostLoadResult.items;
  const productPriceHistory = await loadProductPriceHistory(supabase);
  const fixedExpenses = await loadFixedExpenses(sourceSpreadsheetId || undefined);
  const procurements = await loadProcurements(manualProcurements, sourceSpreadsheetId || undefined);

  const sessions = allSessions.filter(
    (session) => formatBusinessDate(session.created_at ?? "") === businessDate
  );
  const sessionIds = new Set(sessions.map((session) => session.id));
  const orderItems = allOrderItems.filter((item) => sessionIds.has(item.session_id));

  const dailySessionDates = Array.from(
    new Set([
      ...allSessions.map((session) => formatBusinessDate(session.created_at ?? "")),
      ...manualDailyReports.map((item) => item.business_date),
    ])
  ).sort();

  const dailyMetrics: DailyMetric[] = [];
  const cashCountByDate = new Map(allCashCounts.map((item) => [item.business_date, item]));
  for (const date of dailySessionDates) {
    const daySessions = allSessions.filter(
      (session) => formatBusinessDate(session.created_at ?? "") === date
    );
    const dayIds = new Set(daySessions.map((session) => session.id));
    const dayItems = allOrderItems.filter((item) => dayIds.has(item.session_id));
    const dayCashCount = cashCountByDate.get(date) ?? null;
    const baseMetric = buildDailyMetric(
      date,
      daySessions,
      dayItems,
      productCosts,
      fixedExpenses,
      dayCashCount,
      paymentSplits
    );
    const manualMetric = manualDailyReports.find((item) => item.business_date === date);
    dailyMetrics.push(mergeManualDailyMetric(baseMetric, manualMetric));
  }

  const todayMetric =
    dailyMetrics.find((item) => item.date === businessDate) ??
    buildDailyMetric(businessDate, sessions, orderItems, productCosts, fixedExpenses, cashCount, paymentSplits);

  const paidSessions = sessions.filter((session) => session.payment_status === "paid");
  const paymentSummary = buildPaymentSummary(paidSessions, paymentSplits);
  const totalPaymentFees = Array.from(paymentSummary.values()).reduce(
    (sum, item) => sum + item.feeAmount,
    0
  );
  const netRevenue = todayMetric.actualReceived - totalPaymentFees;
  const todayItemSummary = mergeManualProductSalesIntoSummary(
    buildItemProfitSummary(orderItems, productCosts),
    manualProductSales.filter((item) => item.business_date === businessDate),
    productCosts
  );
  const allItemSummary = mergeManualProductSalesIntoSummary(
    buildItemProfitSummary(allOrderItems, productCosts),
    manualProductSales,
    productCosts
  );
  const monthlyMetrics = buildMonthlyMetrics(dailyMetrics, fixedExpenses, procurements);
  const salesDetailRows = buildSalesDetailRows(
    allSessions,
    allOrderItems,
    manualProductSales,
    productCosts,
    paymentSplits
  );

  const allPaidSessions = allSessions.filter((session) => session.payment_status === "paid");
  const allRevenue = allPaidSessions.reduce((sum, session) => sum + Number(session.total_amount ?? 0), 0);
  const allGuests = allSessions.reduce((sum, session) => sum + Number(session.guest_count ?? 0), 0);
  const allPaymentSummary = buildPaymentSummary(allPaidSessions, paymentSplits);
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
    .reduce((sum, item) => sum + item.totalAmount, 0);
  const cumulativeProfit = allNetRevenue - allEstimatedCost - fixedExpenseTotal;
  const allGrossProfit = allRevenue - allEstimatedCost;
  const allGrossMargin = allRevenue > 0 ? allGrossProfit / allRevenue : "";
  const allPaymentSummaryWithManual = buildPaymentSummary(allPaidSessions, paymentSplits);

  for (const manual of manualDailyReports) {
    const cashAmount = Number(manual.cash_income ?? 0);
    if (cashAmount > 0) {
      const existing = allPaymentSummaryWithManual.get("現金") ?? {
        count: 0,
        grossAmount: 0,
        feeAmount: 0,
        netAmount: 0,
      };
      existing.count += 1;
      existing.grossAmount += cashAmount;
      existing.netAmount += cashAmount;
      allPaymentSummaryWithManual.set("現金", existing);
    }

    const transferAmount = Number(manual.transfer_income ?? 0);
    if (transferAmount > 0) {
      const feeAmount = calculatePaymentFee(transferAmount, "歐付寶");
      const existing = allPaymentSummaryWithManual.get("歐付寶") ?? {
        count: 0,
        grossAmount: 0,
        feeAmount: 0,
        netAmount: 0,
      };
      existing.count += 1;
      existing.grossAmount += transferAmount;
      existing.feeAmount += feeAmount;
      existing.netAmount += transferAmount - feeAmount;
      allPaymentSummaryWithManual.set("歐付寶", existing);
    }

    const otherAmount = Number(manual.other_income ?? 0);
    if (otherAmount > 0) {
      const existing = allPaymentSummaryWithManual.get("其他") ?? {
        count: 0,
        grossAmount: 0,
        feeAmount: 0,
        netAmount: 0,
      };
      existing.count += 1;
      existing.grossAmount += otherAmount;
      existing.netAmount += otherAmount;
      allPaymentSummaryWithManual.set("其他", existing);
    }
  }

  const sortedDailyMetrics = [...dailyMetrics].sort((a, b) => a.date.localeCompare(b.date));
  const sortedSessions = [...allSessions].sort((a, b) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
  );
  const sortedManualSessions = [...manualSessionDetails].sort((a, b) => {
    const dateCompare = a.business_date.localeCompare(b.business_date);
    if (dateCompare !== 0) return dateCompare;
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  });

  await replaceSheetValues("每日摘要", [
    [
      "營業日期",
      "今日營業額",
      "今日來客數",
      "今日訂單數",
      "已付款訂單數",
      "未付款訂單數",
      "平均客單",
      "招待總額",
      "現金收入",
      "金流手續費",
      "淨收入",
      "商品成本",
      "商品毛利",
      "毛利率",
      "開店現金",
      "關店現金",
      "系統應有現金",
      "對帳差異",
      "更新時間",
    ],
    ...sortedDailyMetrics.map((item) => {
      const dayCashCount = cashCountByDate.get(item.date);
      const daySessions = allSessions.filter(
        (session) => formatBusinessDate(session.created_at ?? "") === item.date
      );
      const dayPaidSessions = daySessions.filter((session) => session.payment_status === "paid");

      return [
        item.date,
        item.productRevenue,
        item.guestCount,
        daySessions.length,
        dayPaidSessions.length,
        daySessions.length - dayPaidSessions.length,
        dayPaidSessions.length > 0 ? Math.round(item.actualReceived / dayPaidSessions.length) : 0,
        item.complimentary,
        item.cashIncome,
        item.paymentFees,
        item.actualReceived - item.paymentFees,
        item.productCost,
        item.grossProfit,
        item.actualReceived > 0 ? item.grossProfit / item.actualReceived : "",
        dayCashCount?.opening_cash ?? "",
        dayCashCount?.closing_cash ?? "",
        dayCashCount ? Number(dayCashCount.opening_cash ?? 0) + item.cashIncome : "",
        item.reconciliationDiff,
        new Date().toISOString(),
      ];
    }),
  ]);

  await replaceSheetValues("現金清點", [
    [
      "營業日期",
      "開店現金",
      "開店清點時間",
      "開店備註",
      "關店現金",
      "關店清點時間",
      "關店備註",
      "今日現金收入",
      "系統應有現金",
      "關帳差額",
      "更新時間",
    ],
    ...allCashCounts.map((item) => {
      const dayMetric = sortedDailyMetrics.find((metric) => metric.date === item.business_date);
      return [
        item.business_date,
        item.opening_cash ?? "",
        item.opening_counted_at ?? "",
        item.opening_notes ?? "",
        item.closing_cash ?? "",
        item.closing_counted_at ?? "",
        item.closing_notes ?? "",
        dayMetric?.cashIncome ?? 0,
        Number(item.opening_cash ?? 0) + Number(dayMetric?.cashIncome ?? 0),
        dayMetric?.reconciliationDiff ?? "",
        new Date().toISOString(),
      ];
    }),
  ]);

  await replaceSheetValues("訂單明細", [
      [
        "日期",
        "月份",
        "主單編號",
        "品項",
        "類別",
        "銷售數量",
        "售價",
        "單位成本",
        "商品營業額",
        "商品成本",
        "毛利",
        "折扣金額",
        "招待金額",
        "客群類型",
        "備註",
      ],
      ...salesDetailRows.map((row, index) => {
        const previous = salesDetailRows[index - 1];
        const sameGroup =
          previous &&
          previous.businessDate === row.businessDate &&
          previous.sourceType === row.sourceType &&
          previous.orderGroup === row.orderGroup;

        return [
          row.businessDate,
          row.month,
          sameGroup ? "" : row.sessionNumber,
          row.productName,
          row.category,
          row.quantity,
          row.unitPrice,
            row.unitCost,
            row.salesAmount,
            row.productCost,
            row.grossProfit,
            sameGroup ? "" : row.discountAmount,
            sameGroup ? "" : row.complimentaryAmount,
            row.customerType,
            row.note,
          ];
      }),
    ]);

  const monthlyDetailHeaders = [
    "日期",
    "月份",
    "主單編號",
    "品項",
    "類別",
    "銷售數量",
    "售價",
    "單位成本",
    "商品營業額",
    "商品成本",
    "毛利",
    "折扣金額",
    "招待金額",
    "客群類型",
    "備註",
  ];

  const salesDetailRowsByMonth = new Map<string, SalesDetailRow[]>();
  for (const row of salesDetailRows) {
    const normalizedMonth = normalizeMonthValue(row.month);
    const current = salesDetailRowsByMonth.get(normalizedMonth) ?? [];
    current.push({
      ...row,
      month: normalizedMonth,
    });
    salesDetailRowsByMonth.set(normalizedMonth, current);
  }

  for (const [month, rows] of salesDetailRowsByMonth.entries()) {
    const title = buildMonthlyOrderSheetTitle(month);
    if (!title) continue;
    await replaceSheetValues(title, [
      monthlyDetailHeaders,
      ...rows.map((row, index) => {
        const previous = rows[index - 1];
        const sameGroup =
          previous &&
          previous.businessDate === row.businessDate &&
          previous.sourceType === row.sourceType &&
          previous.orderGroup === row.orderGroup;

        return [
          row.businessDate,
          row.month,
          sameGroup ? "" : row.sessionNumber,
          row.productName,
          row.category,
          row.quantity,
          row.unitPrice,
          row.unitCost,
          row.salesAmount,
          row.productCost,
          row.grossProfit,
          sameGroup ? "" : row.discountAmount,
          sameGroup ? "" : row.complimentaryAmount,
          row.customerType,
          row.note,
        ];
      }),
    ]);
  }

  const currentMonthTitle = buildMonthlyOrderSheetTitle(businessDate.slice(0, 7));
  const currentTitles = await listSheetTitles();
  for (const title of currentTitles) {
    if (title === "訂單明細") {
      await setSheetHidden(title, true);
      continue;
    }
    if (!/^\d{2}-\d{2}訂單明細$/.test(title)) continue;
    await setSheetHidden(title, title !== currentMonthTitle);
  }

  const stayAnalysisMap = new Map<
    string,
    { count: number; totalMinutes: number; maxMinutes: number; minMinutes: number }
  >();
  const appendStayMetric = (customerType: string | null | undefined, stayMinutes: number | string) => {
    const numericStay = Number(stayMinutes);
    if (!Number.isFinite(numericStay) || numericStay <= 0) return;
    const key = customerType?.trim() || "未分類";
    const existing = stayAnalysisMap.get(key) ?? {
      count: 0,
      totalMinutes: 0,
      maxMinutes: 0,
      minMinutes: Number.POSITIVE_INFINITY,
    };
    existing.count += 1;
    existing.totalMinutes += numericStay;
    existing.maxMinutes = Math.max(existing.maxMinutes, numericStay);
    existing.minMinutes = Math.min(existing.minMinutes, numericStay);
    stayAnalysisMap.set(key, existing);
  };

  for (const session of sortedSessions) {
    appendStayMetric(
      session.customer_type,
      calculateStayMinutes(session.created_at, session.paid_at, session.payment_status)
    );
  }
  for (const session of sortedManualSessions) {
    appendStayMetric(
      session.customer_type,
      calculateStayMinutes(
        session.created_at,
        session.paid_at,
        session.payment_status,
        session.stay_minutes ?? null
      )
    );
  }

  const stayAnalysisEntries = Array.from(stayAnalysisMap.entries());
  await replaceSheetValues("客群停留分析", [
    ["客人類型", "訂單數", "平均停留分鐘", "最長停留分鐘", "最短停留分鐘", "平均停留小時", "", "客群圖例", "訂單數", "", "來客占比圓餅圖"],
    ...stayAnalysisEntries.map(([customerType, item], index) => [
      customerType,
      item.count,
      item.count > 0 ? Math.round(item.totalMinutes / item.count) : 0,
      item.maxMinutes,
      item.minMinutes === Number.POSITIVE_INFINITY ? 0 : item.minMinutes,
      item.count > 0 ? Number((item.totalMinutes / item.count / 60).toFixed(2)) : 0,
      "",
      customerType,
      item.count,
      "",
      index === 0 ? "圖表由同步程式自動建立" : "",
    ]),
  ]);

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

  await replaceSheetValues("品項毛利", [
    ["品項名稱", "類別", "累積銷售數量", "累積營業額", "單位成本", "估算總成本", "累積毛利", "毛利率", "備註"],
    ...Array.from(allItemSummary.entries()).map(([productName, item]) => [
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
  ]);

  await replaceSheetValues("付款方式淨收入", [
    ["付款方式", "筆數", "收入金額", "手續費", "淨收入"],
    ...Array.from(allPaymentSummaryWithManual.entries()).map(([method, item]) => [
      method,
      item.count,
      item.grossAmount,
      item.feeAmount,
      item.netAmount,
    ]),
  ]);

  await replaceSheetValues("每日毛利", [
    ["營業日期", "營業額", "商品成本", "商品毛利", "毛利率", "金流手續費", "淨收入", "更新時間"],
    ...sortedDailyMetrics.map((item) => [
      item.date,
      item.actualReceived,
      item.productCost,
      item.grossProfit,
      item.actualReceived > 0 ? item.grossProfit / item.actualReceived : "",
      item.paymentFees,
      item.actualReceived - item.paymentFees,
      new Date().toISOString(),
    ]),
  ]);

  await syncSourceTemplateSheets(dailyMetrics, allItemSummary, monthlyMetrics, productCosts, fixedExpenses, procurements);

  await replaceSheetValues("固定支出", [
    ["日期", "月份", "支出項目", "類型", "金額", "運費", "總支出", "是否已付款", "備註"],
    ...fixedExpenses.map((item, index) => {
      const row = index + 2;
      return [
        item.date,
        `=IF(A${row}="","",TEXT(A${row},"yyyy-mm"))`,
        item.item,
        item.type,
        item.amount,
        item.shippingFee,
        `=IF(AND(E${row}="",F${row}=""),"",E${row}+F${row})`,
        item.isPaid ? "是" : "否",
        item.note,
      ];
    }),
  ]);

  await replaceSheetValues("進貨耗材", [
    ["日期", "月份", "品項", "類型", "單價", "數量", "運費", "總金額", "供應商", "備註"],
    ...procurements.map((item, index) => {
      const row = index + 2;
      return [
        item.date,
        `=IF(A${row}="","",TEXT(A${row},"yyyy-mm"))`,
        item.item,
        item.type,
        item.unitPrice,
        item.quantity,
        item.shippingFee,
        `=IF(AND(E${row}="",F${row}="",G${row}=""),"",E${row}*F${row}+G${row})`,
        item.supplier,
        item.note,
        ];
      }),
    ]);

  await replaceSheetValues("價格歷史", [
    ["生效日", "品項名稱", "歷史售價", "目前單位成本", "參考毛利", "備註"],
    ...productPriceHistory.map((item, index) => {
      const row = index + 2;
      return [
        item.effectiveFrom,
        item.productName,
        item.price,
        `=IFERROR(VLOOKUP(B${row},品項成本表!A:D,4,FALSE),"")`,
        `=IF(OR(C${row}="",D${row}=""),"",C${row}-D${row})`,
        item.note,
      ];
    }),
  ]);

  const overviewRows = sortedDailyMetrics.map((item, index) => {
    const row = index + 2;
    return [
      item.date,
      `=TEXT(A${row},"yyyy-mm")`,
      item.guestCount,
      `=E${row}+F${row}`,
      item.cashIncome,
      item.transferIncome,
      item.otherIncome,
      item.tip,
      item.discount,
      item.complimentary,
      item.refund,
      `=D${row}+G${row}+H${row}-I${row}-J${row}-K${row}`,
        `=SUMIF(訂單明細!A:A,A${row},訂單明細!J:J)`,
      `=D${row}-M${row}`,
      item.reconciliationDiff,
      `=ROUND(N${row}*0.2,0)`,
      `=IF(F${row}<=0,0,MAX(1,ROUND(F${row}*2.45%,0)))`,
      `=L${row}-P${row}-Q${row}`,
    ];
  });

  await replaceSheetValues("每日總覽", [
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
      "手續費",
      "淨收入",
    ],
    ...overviewRows,
  ]);

  const itemEntries = Array.from(allItemSummary.entries()).sort(
    (a, b) => b[1].grossProfit - a[1].grossProfit || b[1].quantity - a[1].quantity
  );
  const itemAnalysisRows = itemEntries.map(([productName, item], index) => {
    const row = index + 6;
    return [
      productName,
      `=IFERROR(VLOOKUP(A${row},品項成本表!A:H,2,FALSE),"")`,
      `=IFERROR(VLOOKUP(A${row},品項成本表!A:H,3,FALSE),"")`,
      `=IFERROR(VLOOKUP(A${row},品項成本表!A:H,4,FALSE),0)`,
      item.quantity,
      item.salesAmount,
      `=E${row}*D${row}`,
      `=F${row}-G${row}`,
      `=IF(F${row}=0,"",H${row}/F${row})`,
      `=IFERROR(VLOOKUP(A${row},品項成本表!A:H,7,FALSE),"")`,
      `=IF(H${row}=\"\",\"\",RANK(H${row},$H$6:$H$${itemEntries.length + 5},0))`,
      `=IF(E${row}=0,"待觀察",IF(H${row}>0,"主力商品","待觀察"))`,
    ];
  });

  await replaceSheetValues("品項分析", [
    ["最賺品項", `=IFERROR(INDEX(A6:A,MATCH(MAX(H6:H),H6:H,0)),"")`, "", "最熱銷品項", `=IFERROR(INDEX(A6:A,MATCH(MAX(E6:E),E6:E,0)),"")`],
    [],
    [],
    [],
    ["品項名稱", "類別", "售價", "單位成本", "銷售數量", "商品營業額", "商品成本", "毛利", "毛利率", "是否主打", "毛利排名", "建議"],
    ...itemAnalysisRows,
  ]);

  const currentYear = todayIsoDate().slice(0, 4);
  const monthRows = Array.from({ length: 12 }, (_, index) => {
    const month = `${currentYear}-${String(index + 1).padStart(2, "0")}`;
    const row = index + 9;
    return [
      month,
      `=SUMIF(每日總覽!B:B,A${row},每日總覽!C:C)`,
      `=SUMIF(每日總覽!B:B,A${row},每日總覽!D:D)`,
      `=SUMIF(每日總覽!B:B,A${row},每日總覽!H:H)`,
      `=SUMIF(每日總覽!B:B,A${row},每日總覽!G:G)+SUMIF(每日總覽!B:B,A${row},每日總覽!F:F)`,
      `=SUMIF(每日總覽!B:B,A${row},每日總覽!I:I)`,
      `=SUMIF(每日總覽!B:B,A${row},每日總覽!J:J)`,
      `=SUMIF(每日總覽!B:B,A${row},每日總覽!K:K)`,
      `=SUMIF(每日總覽!B:B,A${row},每日總覽!L:L)`,
      `=SUMIF(每日總覽!B:B,A${row},每日總覽!M:M)`,
      `=SUMIF(進貨耗材!B:B,A${row},進貨耗材!H:H)`,
      `=SUMIFS(固定支出!G:G,固定支出!B:B,A${row},固定支出!D:D,"<>場租")`,
      `=SUMIF(每日總覽!B:B,A${row},每日總覽!P:P)`,
      `=I${row}-J${row}-K${row}-L${row}-M${row}-SUMIF(每日總覽!B:B,A${row},每日總覽!Q:Q)`,
      `=I${row}-K${row}-L${row}-M${row}`,
    ];
  });

  await replaceSheetValues("月總表", [
    ["年份", currentYear, "", "本年度場租累計", `=SUM(M9:M20)`],
    ["", "", "", "累計固定/其他支出", `=SUM(L9:L20)`],
    ["", "", "", "累計進貨/耗材支出", `=SUM(K9:K20)`],
    ["", "", "", "累計實收", `=SUM(I9:I20)`],
    ["", "", "", "累計淨收入", `=SUM(N9:N20)`],
    [],
    [],
    ["月份", "客人數", "商品營業額", "小費", "其他收入", "折扣", "招待/未收", "退款", "實收金額", "商品成本(依銷售)", "進貨/耗材支出", "固定/其他支出", "場租", "淨收入", "淨現金流"],
    ...monthRows,
  ]);

  await replaceSheetValues("財報", [
    ["財報項目", "數值", "", "", "月別財報", "商品營業額", "實收金額", "總支出", "淨收入"],
    ["累積商品營業額", `=SUM(月總表!C9:C20)`],
    ["累積實收金額", `=SUM(月總表!I9:I20)`],
    ["累積商品成本", `=SUM(月總表!J9:J20)`],
    ["累積手續費", `=SUM(每日總覽!Q:Q)`],
    ["", ""],
    ["成本區", ""],
    ["人力成本", `=SUMIFS(固定支出!G:G,固定支出!D:D,"人力",固定支出!H:H,"是")`],
    ["水電雜費", `=SUMIF(進貨耗材!D:D,"雜費",進貨耗材!H:H)`],
    ["消耗品", `=SUMIF(進貨耗材!D:D,"包材",進貨耗材!H:H)`],
    ["設備攤提", `=SUMIFS(固定支出!G:G,固定支出!D:D,"設備",固定支出!H:H,"是")`],
    ["場租", `=SUM(月總表!M9:M20)`],
    ["", ""],
    ["最終計算", ""],
    ["營業毛利", `=B3-B4-B5`],
    ["營業費用", `=SUM(B8:B12)`],
    ["最終淨利", `=B15-B16`],
    [],
    ["月份", "", "", "", "月份", "商品營業額", "實收金額", "總支出", "淨收入"],
    ...Array.from({ length: 12 }, (_, index) => {
      const sourceRow = index + 9;
      const targetRow = index + 20;
      return [
        `=月總表!A${sourceRow}`,
        "",
        "",
        "",
        `=月總表!A${sourceRow}`,
        `=月總表!C${sourceRow}`,
        `=月總表!I${sourceRow}`,
        `=月總表!J${sourceRow}+月總表!K${sourceRow}+月總表!L${sourceRow}+月總表!M${sourceRow}+SUMIF(每日總覽!B:B,E${targetRow},每日總覽!Q:Q)`,
        `=月總表!N${sourceRow}`,
      ];
    }),
  ]);

  await replaceSheetValues("財務分析", [
    ["分析項目", "數值", "", "說明"],
    ["平均客單價", `=IF(SUM(每日總覽!C2:C)=0,0,ROUND(SUM(每日總覽!L2:L)/SUM(每日總覽!C2:C),0))`, "", "實收金額 ÷ 累積來客數"],
    ["每日來客數", `=IF(COUNTA(每日總覽!A2:A)=0,0,ROUND(SUM(每日總覽!C2:C)/COUNTA(每日總覽!A2:A),1))`, "", "累積來客數 ÷ 有營業資料天數"],
    ["營業毛利率", `=IF(財報!B3=0,0,財報!B15/財報!B3)`, "", "營業毛利 ÷ 累積實收金額"],
    ["損益平衡營業額", `=IF(B4<=0,"",ROUNDUP(財報!B16/B4,0))`, "", "營業費用 ÷ 營業毛利率"],
    ["平均每日淨利", `=IF(COUNTA(每日總覽!A2:A)=0,0,ROUND(財報!B17/COUNTA(每日總覽!A2:A),0))`, "", "最終淨利 ÷ 有營業資料天數"],
    ["回本天數", `=IF(B6<=0,"",ROUNDUP(財報!B16/B6,0))`, "", "營業費用 ÷ 平均每日淨利"],
    ["設備攤提回收天數", `=IF(B6<=0,"",ROUNDUP(財報!B11/B6,0))`, "", "設備攤提 ÷ 平均每日淨利"],
  ]);

  await applySheetStyles([
    {
      title: "每日摘要",
      frozenRows: 1,
      headerRowIndex: 0,
      dateColumns: [0],
      currencyColumns: [1, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17],
      percentColumns: [13],
      autoResizeColumnCount: 19,
      headerRowHeight: 42,
      bodyRowHeight: 34,
      columnWidths: [140, 130, 120, 120, 135, 135, 135, 125, 125, 125, 125, 125, 125, 120, 125, 125, 125, 125, 220],
      leftAlignColumns: [18],
      centerAlignColumns: [0, 2, 3, 4, 5, 6, 13],
      rightAlignColumns: [1, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17],
      columnBackgrounds: [
        { columns: [0], color: { red: 0.92, green: 0.96, blue: 0.99 } },
        { columns: [1, 2, 3, 4, 5, 6], color: { red: 0.95, green: 0.97, blue: 0.93 } },
        { columns: [7, 8, 9, 10, 11, 12, 14, 15, 16, 17], color: { red: 1, green: 0.96, blue: 0.9 } },
        { columns: [13], color: { red: 0.93, green: 0.95, blue: 1 } },
        { columns: [18], color: { red: 0.97, green: 0.97, blue: 0.97 } },
      ],
    },
    {
      title: "現金清點",
      frozenRows: 1,
      headerRowIndex: 0,
      dateColumns: [0],
      currencyColumns: [1, 4, 7, 8, 9],
      autoResizeColumnCount: 11,
      headerRowHeight: 42,
      bodyRowHeight: 34,
      columnWidths: [135, 125, 240, 190, 125, 240, 190, 125, 125, 125, 220],
      leftAlignColumns: [2, 3, 5, 6, 10],
      centerAlignColumns: [0],
      rightAlignColumns: [1, 4, 7, 8, 9],
      columnBackgrounds: [
        { columns: [0], color: { red: 0.92, green: 0.96, blue: 0.99 } },
        { columns: [1, 4, 7, 8, 9], color: { red: 1, green: 0.96, blue: 0.9 } },
        { columns: [2, 3, 5, 6, 10], color: { red: 0.97, green: 0.97, blue: 0.97 } },
      ],
    },
    {
        title: "訂單明細",
        frozenRows: 1,
        headerRowIndex: 0,
        dateColumns: [0],
        currencyColumns: [7, 8, 9, 10, 11, 12],
        autoResizeColumnCount: 15,
        headerRowHeight: 42,
        bodyRowHeight: 34,
        columnWidths: [145, 125, 180, 220, 140, 110, 125, 125, 145, 145, 145, 135, 135, 140, 260],
        leftAlignColumns: [2, 3, 4, 14],
        centerAlignColumns: [0, 1, 5, 13],
        rightAlignColumns: [6, 7, 8, 9, 10, 11, 12],
        columnBackgrounds: [
          { columns: [0, 1], color: { red: 0.92, green: 0.96, blue: 0.99 } },
          { columns: [2, 3, 4, 13], color: { red: 0.95, green: 0.97, blue: 0.93 } },
          { columns: [6, 7, 8, 9, 10], color: { red: 1, green: 0.96, blue: 0.9 } },
          { columns: [11, 12], color: { red: 1, green: 0.92, blue: 0.92 } },
          { columns: [5, 14], color: { red: 0.97, green: 0.97, blue: 0.97 } },
        ],
      },
      ...Array.from(salesDetailRowsByMonth.keys())
        .map((month) => buildMonthlyOrderSheetTitle(month))
        .filter(Boolean)
        .map((title) => ({
          title,
          frozenRows: 1,
          headerRowIndex: 0,
          dateColumns: [0],
          currencyColumns: [6, 7, 8, 9, 10, 11, 12],
          autoResizeColumnCount: 15,
          headerRowHeight: 42,
          bodyRowHeight: 34,
          columnWidths: [145, 125, 180, 220, 140, 110, 125, 125, 145, 145, 145, 135, 135, 140, 260],
          leftAlignColumns: [2, 3, 4, 14],
          centerAlignColumns: [0, 1, 5, 13],
          rightAlignColumns: [6, 7, 8, 9, 10, 11, 12],
          columnBackgrounds: [
            { columns: [0, 1], color: { red: 0.92, green: 0.96, blue: 0.99 } },
            { columns: [2, 3, 4, 13], color: { red: 0.95, green: 0.97, blue: 0.93 } },
            { columns: [6, 7, 8, 9, 10], color: { red: 1, green: 0.96, blue: 0.9 } },
            { columns: [11, 12], color: { red: 1, green: 0.92, blue: 0.92 } },
            { columns: [5, 14], color: { red: 0.97, green: 0.97, blue: 0.97 } },
          ],
        })),
      {
        title: "品項成本表",
        frozenRows: 1,
        headerRowIndex: 0,
        currencyColumns: [2, 3, 4],
      percentColumns: [5],
      autoResizeColumnCount: 8,
      headerRowHeight: 42,
      bodyRowHeight: 34,
      columnWidths: [220, 150, 130, 130, 140, 125, 125, 240],
      leftAlignColumns: [0, 1, 7],
      centerAlignColumns: [6],
      rightAlignColumns: [2, 3, 4, 5],
        columnBackgrounds: [
          { columns: [0, 1], color: { red: 0.92, green: 0.96, blue: 0.99 } },
          { columns: [2, 3, 4], color: { red: 1, green: 0.96, blue: 0.9 } },
          { columns: [5], color: { red: 0.93, green: 0.95, blue: 1 } },
          { columns: [6, 7], color: { red: 0.97, green: 0.97, blue: 0.97 } },
        ],
      },
      {
        title: "價格歷史",
        frozenRows: 1,
        headerRowIndex: 0,
        dateColumns: [0],
        currencyColumns: [2, 3, 4],
        autoResizeColumnCount: 6,
        headerRowHeight: 42,
        bodyRowHeight: 34,
        columnWidths: [135, 220, 130, 130, 130, 260],
        leftAlignColumns: [1, 5],
        centerAlignColumns: [0],
        rightAlignColumns: [2, 3, 4],
        columnBackgrounds: [
          { columns: [0, 1], color: { red: 0.92, green: 0.96, blue: 0.99 } },
          { columns: [2, 3, 4], color: { red: 1, green: 0.96, blue: 0.9 } },
          { columns: [5], color: { red: 0.97, green: 0.97, blue: 0.97 } },
        ],
      },
      {
        title: "固定支出",
        frozenRows: 1,
        headerRowIndex: 0,
      dateColumns: [0],
      currencyColumns: [4, 5, 6],
      autoResizeColumnCount: 9,
      headerRowHeight: 42,
      bodyRowHeight: 34,
      columnWidths: [135, 125, 220, 150, 130, 120, 135, 120, 240],
      leftAlignColumns: [2, 3, 8],
      centerAlignColumns: [0, 1, 7],
      rightAlignColumns: [4, 5, 6],
      columnBackgrounds: [
        { columns: [0, 1], color: { red: 0.92, green: 0.96, blue: 0.99 } },
        { columns: [2, 3], color: { red: 0.95, green: 0.97, blue: 0.93 } },
        { columns: [4, 5, 6], color: { red: 1, green: 0.96, blue: 0.9 } },
        { columns: [7, 8], color: { red: 0.97, green: 0.97, blue: 0.97 } },
      ],
    },
    {
      title: "進貨耗材",
      frozenRows: 1,
      headerRowIndex: 0,
      dateColumns: [0],
      currencyColumns: [4, 6, 7],
      autoResizeColumnCount: 10,
      headerRowHeight: 42,
      bodyRowHeight: 34,
      columnWidths: [135, 125, 210, 140, 125, 105, 120, 140, 220, 260],
      leftAlignColumns: [2, 3, 8, 9],
      centerAlignColumns: [0, 1, 5],
      rightAlignColumns: [4, 6, 7],
      columnBackgrounds: [
        { columns: [0, 1], color: { red: 0.92, green: 0.96, blue: 0.99 } },
        { columns: [2, 3], color: { red: 0.95, green: 0.97, blue: 0.93 } },
        { columns: [4, 5, 6, 7], color: { red: 1, green: 0.96, blue: 0.9 } },
        { columns: [8, 9], color: { red: 0.97, green: 0.97, blue: 0.97 } },
      ],
    },
    {
      title: "每日總覽",
      frozenRows: 1,
      headerRowIndex: 0,
      dateColumns: [0],
      currencyColumns: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
      autoResizeColumnCount: 18,
      headerRowHeight: 44,
      bodyRowHeight: 36,
      columnWidths: [145, 125, 105, 145, 130, 130, 130, 115, 115, 130, 115, 145, 135, 145, 130, 120, 120, 145],
      centerAlignColumns: [0, 1, 2, 14],
      rightAlignColumns: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17],
      columnBackgrounds: [
        { columns: [0, 1], color: { red: 0.92, green: 0.96, blue: 0.99 } },
        { columns: [2], color: { red: 0.95, green: 0.97, blue: 0.93 } },
        { columns: [3, 4, 5, 6, 7, 8, 9, 10, 11], color: { red: 1, green: 0.96, blue: 0.9 } },
        { columns: [12, 13, 15, 16, 17], color: { red: 0.95, green: 0.97, blue: 0.93 } },
        { columns: [14], color: { red: 1, green: 0.92, blue: 0.92 } },
      ],
    },
    {
      title: "品項分析",
      frozenRows: 5,
      headerRowIndex: 4,
      currencyColumns: [2, 3, 5, 6, 7],
      percentColumns: [8],
      autoResizeColumnCount: 12,
      headerRowHeight: 44,
      bodyRowHeight: 36,
      columnWidths: [220, 150, 130, 130, 115, 145, 145, 145, 120, 125, 120, 180],
      leftAlignColumns: [0, 1, 11],
      centerAlignColumns: [4, 9, 10],
      rightAlignColumns: [2, 3, 5, 6, 7, 8],
      columnBackgrounds: [
        { columns: [0, 1], color: { red: 0.92, green: 0.96, blue: 0.99 } },
        { columns: [2, 3, 5, 6, 7], color: { red: 1, green: 0.96, blue: 0.9 } },
        { columns: [4], color: { red: 0.95, green: 0.97, blue: 0.93 } },
        { columns: [8, 10], color: { red: 0.93, green: 0.95, blue: 1 } },
        { columns: [9, 11], color: { red: 0.97, green: 0.97, blue: 0.97 } },
      ],
    },
    {
      title: "月總表",
      frozenRows: 8,
      headerRowIndex: 7,
      currencyColumns: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
      autoResizeColumnCount: 15,
      headerRowHeight: 44,
      bodyRowHeight: 36,
      columnWidths: [125, 105, 145, 115, 130, 115, 125, 115, 145, 145, 145, 145, 120, 145, 145],
      centerAlignColumns: [0, 1],
      rightAlignColumns: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
      columnBackgrounds: [
        { columns: [0], color: { red: 0.92, green: 0.96, blue: 0.99 } },
        { columns: [1], color: { red: 0.95, green: 0.97, blue: 0.93 } },
        { columns: [2, 3, 4, 5, 6, 7, 8], color: { red: 1, green: 0.96, blue: 0.9 } },
        { columns: [9, 10, 11, 12, 13, 14], color: { red: 0.95, green: 0.97, blue: 0.93 } },
      ],
    },
    {
      title: "品項毛利",
      frozenRows: 1,
      headerRowIndex: 0,
      currencyColumns: [3, 4, 5, 6],
      percentColumns: [7],
      autoResizeColumnCount: 9,
      headerRowHeight: 42,
      bodyRowHeight: 34,
      columnWidths: [220, 150, 115, 145, 130, 145, 145, 120, 220],
      leftAlignColumns: [0, 1, 8],
      centerAlignColumns: [2],
      rightAlignColumns: [3, 4, 5, 6, 7],
      columnBackgrounds: [
        { columns: [0, 1], color: { red: 0.92, green: 0.96, blue: 0.99 } },
        { columns: [2, 3, 4, 5, 6], color: { red: 1, green: 0.96, blue: 0.9 } },
        { columns: [7], color: { red: 0.93, green: 0.95, blue: 1 } },
        { columns: [8], color: { red: 0.97, green: 0.97, blue: 0.97 } },
      ],
    },
    {
      title: "付款方式淨收入",
      frozenRows: 1,
      headerRowIndex: 0,
      currencyColumns: [2, 3, 4],
      autoResizeColumnCount: 5,
      headerRowHeight: 42,
      bodyRowHeight: 34,
      columnWidths: [190, 110, 145, 145, 145],
      leftAlignColumns: [0],
      centerAlignColumns: [1],
      rightAlignColumns: [2, 3, 4],
      columnBackgrounds: [
        { columns: [0], color: { red: 0.92, green: 0.96, blue: 0.99 } },
        { columns: [1], color: { red: 0.95, green: 0.97, blue: 0.93 } },
        { columns: [2, 3, 4], color: { red: 1, green: 0.96, blue: 0.9 } },
      ],
    },
    {
      title: "每日毛利",
      frozenRows: 1,
      headerRowIndex: 0,
      dateColumns: [0],
      currencyColumns: [1, 2, 3, 5, 6],
      percentColumns: [4],
      autoResizeColumnCount: 8,
      headerRowHeight: 42,
      bodyRowHeight: 34,
      columnWidths: [145, 145, 145, 145, 120, 145, 145, 210],
      centerAlignColumns: [0],
      rightAlignColumns: [1, 2, 3, 4, 5, 6],
      leftAlignColumns: [7],
      columnBackgrounds: [
        { columns: [0], color: { red: 0.92, green: 0.96, blue: 0.99 } },
        { columns: [1, 2, 3, 5, 6], color: { red: 1, green: 0.96, blue: 0.9 } },
        { columns: [4], color: { red: 0.93, green: 0.95, blue: 1 } },
        { columns: [7], color: { red: 0.97, green: 0.97, blue: 0.97 } },
      ],
    },
    {
      title: "客群停留分析",
      frozenRows: 1,
      headerRowIndex: 0,
      autoResizeColumnCount: 11,
      headerRowHeight: 42,
      bodyRowHeight: 34,
      columnWidths: [170, 120, 170, 170, 170, 145, 30, 170, 120, 30, 260],
      leftAlignColumns: [0, 7],
      centerAlignColumns: [1, 8],
      rightAlignColumns: [2, 3, 4, 5],
      columnBackgrounds: [
        { columns: [0], color: { red: 0.92, green: 0.96, blue: 0.99 } },
        { columns: [1], color: { red: 0.95, green: 0.97, blue: 0.93 } },
        { columns: [2, 3, 4, 5], color: { red: 1, green: 0.96, blue: 0.9 } },
        { columns: [7, 8], color: { red: 0.97, green: 0.97, blue: 0.97 } },
        { columns: [10], color: { red: 0.93, green: 0.95, blue: 1 } },
      ],
    },
    {
      title: "財報",
      frozenRows: 1,
      headerRowIndex: 0,
      currencyColumns: [1, 5, 6, 7, 8],
      autoResizeColumnCount: 9,
      headerRowHeight: 42,
      bodyRowHeight: 34,
      columnWidths: [180, 145, 40, 40, 150, 145, 145, 145, 145],
      leftAlignColumns: [0, 4],
      rightAlignColumns: [1, 5, 6, 7, 8],
      columnBackgrounds: [
        { columns: [0, 4], color: { red: 0.92, green: 0.96, blue: 0.99 } },
        { columns: [1, 5, 6, 7, 8], color: { red: 1, green: 0.96, blue: 0.9 } },
      ],
      customRowHeights: [
        { rowIndex: 6, pixelSize: 38 },
        { rowIndex: 13, pixelSize: 38 },
      ],
    },
      {
        title: "財務分析",
        frozenRows: 1,
        headerRowIndex: 0,
        autoResizeColumnCount: 4,
        headerRowHeight: 42,
        bodyRowHeight: 34,
        columnWidths: [180, 150, 40, 280],
        leftAlignColumns: [0, 3],
        rightAlignColumns: [1],
        columnBackgrounds: [
          { columns: [0], color: { red: 0.92, green: 0.96, blue: 0.99 } },
          { columns: [1], color: { red: 1, green: 0.96, blue: 0.9 } },
          { columns: [3], color: { red: 0.97, green: 0.97, blue: 0.97 } },
        ],
        customNumberFormats: [
          { startRowIndex: 1, endRowIndex: 2, columnIndex: 1, type: "CURRENCY", pattern: "\"NT$\"#,##0" },
          { startRowIndex: 2, endRowIndex: 3, columnIndex: 1, type: "NUMBER", pattern: "0.0" },
          { startRowIndex: 3, endRowIndex: 4, columnIndex: 1, type: "PERCENT", pattern: "0.0%" },
          { startRowIndex: 4, endRowIndex: 6, columnIndex: 1, type: "CURRENCY", pattern: "\"NT$\"#,##0" },
          { startRowIndex: 6, endRowIndex: 8, columnIndex: 1, type: "NUMBER", pattern: "0" },
        ],
      },
  ]);
  await applySheetDropdowns();
  await applySheetCharts(itemEntries.length, stayAnalysisEntries.length);

  return {
    businessDate,
    revenue: todayMetric.actualReceived,
    guests: todayMetric.guestCount,
    sessions: sessions.length,
    cashRevenue: todayMetric.cashIncome,
    totalPaymentFees,
    netRevenue,
    costItems: productCosts.length,
    costSource: productCostLoadResult.source,
    reportCostRows: productCostLoadResult.reportRowCount,
    sourceCostRows: productCostLoadResult.sourceRowCount,
    cumulativeProfit,
  };
}
