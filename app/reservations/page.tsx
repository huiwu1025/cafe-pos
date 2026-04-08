"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type ReservationInfo = {
  reservationId: string;
  reservationCode: string;
  reservationName: string;
  reservationPhone: string;
  reservationDate: string;
  reservationTime: string;
  guestCount: number;
  notes: string;
  seatCodes: string[];
};

function todayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sortSeatCodes(a: string, b: string) {
  const aIsBar = a.startsWith("A");
  const bIsBar = b.startsWith("A");
  if (aIsBar && bIsBar) return Number(a.replace("A", "")) - Number(b.replace("A", ""));
  return a.localeCompare(b);
}

function formatSeatLabel(seatCodes: string[]) {
  if (seatCodes.length === 0) return "未指定";
  const isAllBar = seatCodes.every((seat) => seat.startsWith("A"));
  if (isAllBar) return seatCodes.join("、");
  return seatCodes.map((seat) => `${seat}桌`).join("、");
}

function normalizeTimeLabel(value: string) {
  return String(value).slice(0, 5);
}

export default function ReservationsPage() {
  const router = useRouter();
  const [reservations, setReservations] = useState<ReservationInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadReservations = useCallback(async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("reservation_seats")
        .select(`
          reservation_id,
          seats:seat_id (
            seat_code
          ),
          reservations:reservation_id (
            id,
            reservation_code,
            reservation_name,
            reservation_phone,
            reservation_date,
            reservation_time,
            guest_count,
            notes,
            status
          )
        `);

      if (error) throw error;

      const reservationMap = new Map<string, ReservationInfo>();
      const today = todayIsoDate();

      for (const row of data ?? []) {
        const reservation = Array.isArray(row.reservations)
          ? row.reservations[0]
          : row.reservations;
        const seat = Array.isArray(row.seats) ? row.seats[0] : row.seats;

        if (
          !reservation?.id ||
          !seat?.seat_code ||
          reservation.status !== "reserved" ||
          reservation.reservation_date !== today
        ) {
          continue;
        }

        const existing = reservationMap.get(reservation.id);
        if (existing) {
          existing.seatCodes.push(seat.seat_code);
        } else {
          reservationMap.set(reservation.id, {
            reservationId: reservation.id,
            reservationCode: reservation.reservation_code,
            reservationName: reservation.reservation_name,
            reservationPhone: reservation.reservation_phone,
            reservationDate: reservation.reservation_date,
            reservationTime: normalizeTimeLabel(reservation.reservation_time),
            guestCount: Number(reservation.guest_count ?? 0),
            notes: reservation.notes ?? "",
            seatCodes: [seat.seat_code],
          });
        }
      }

      const nextReservations = Array.from(reservationMap.values())
        .map((reservation) => ({
          ...reservation,
          seatCodes: reservation.seatCodes.sort(sortSeatCodes),
        }))
        .sort((a, b) => a.reservationTime.localeCompare(b.reservationTime));

      setReservations(nextReservations);
    } catch (error) {
      console.error("Failed to load reservations", error);
      alert("讀取今日預約失敗");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReservations();
  }, [loadReservations]);

  const stats = useMemo(() => {
    return {
      count: reservations.length,
      guests: reservations.reduce((sum, item) => sum + item.guestCount, 0),
    };
  }, [reservations]);

  async function updateReservationStatus(id: string, status: "cancelled" | "no_show") {
    const confirmed = window.confirm(
      status === "cancelled" ? "確定取消這筆預約？" : "確定將這筆預約標記為逾時？"
    );
    if (!confirmed) return;

    try {
      const { error } = await supabase.from("reservations").update({ status }).eq("id", id);
      if (error) throw error;
      await loadReservations();
    } catch (error) {
      console.error("Failed to update reservation status", error);
      alert("更新預約狀態失敗");
    }
  }

  return (
    <main className="pos-shell p-3 md:p-4">
      <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-3">
        <header className="pos-panel rounded-[28px] px-4 py-3 lg:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-fuchsia-700">
                Reservation Board
              </p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900 lg:text-3xl">今日預約</h1>
            </div>
            <div className="grid grid-cols-3 gap-2 lg:flex">
              <button
                type="button"
                onClick={() => router.push("/")}
                className="h-11 rounded-2xl bg-slate-100 px-4 text-sm font-semibold text-slate-800"
              >
                返回座位
              </button>
              <button
                type="button"
                onClick={() => router.push("/orders")}
                className="h-11 rounded-2xl bg-sky-100 px-4 text-sm font-semibold text-sky-900"
              >
                歷史訂單
              </button>
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="h-11 rounded-2xl bg-emerald-100 px-4 text-sm font-semibold text-emerald-900"
              >
                今日後台
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 lg:max-w-[360px]">
            <div className="rounded-[20px] bg-slate-50 px-3 py-3">
              <p className="text-[11px] text-slate-500">今日預約數</p>
              <p className="mt-1 text-2xl font-bold text-fuchsia-700">{stats.count} 筆</p>
            </div>
            <div className="rounded-[20px] bg-slate-50 px-3 py-3">
              <p className="text-[11px] text-slate-500">預約來客數</p>
              <p className="mt-1 text-2xl font-bold text-sky-700">{stats.guests} 人</p>
            </div>
          </div>
        </header>

        <section className="pos-panel min-h-0 flex-1 rounded-[28px] p-3 lg:p-4">
          {isLoading ? (
            <div className="rounded-[22px] bg-slate-50 p-4 text-sm text-slate-500">讀取中...</div>
          ) : reservations.length === 0 ? (
            <div className="rounded-[22px] bg-slate-50 p-4 text-sm text-slate-500">今日尚無預約</div>
          ) : (
            <div className="pos-scroll grid min-h-0 gap-3 pr-1 lg:grid-cols-2">
              {reservations.map((reservation) => (
                <div
                  key={reservation.reservationId}
                  className="rounded-[24px] border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-bold text-slate-900">
                        {reservation.reservationTime} {reservation.reservationName}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">{reservation.reservationPhone}</p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                      {reservation.reservationCode}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <InfoMini label="座位" value={formatSeatLabel(reservation.seatCodes)} />
                    <InfoMini label="人數" value={`${reservation.guestCount} 人`} />
                    <InfoMini label="日期" value={reservation.reservationDate} />
                  </div>

                  <div className="mt-3 rounded-[18px] bg-white px-3 py-3 text-sm text-slate-600">
                    {reservation.notes || "無備註"}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => updateReservationStatus(reservation.reservationId, "cancelled")}
                      className="h-11 rounded-2xl bg-rose-100 px-3 text-sm font-semibold text-rose-800 hover:bg-rose-200"
                    >
                      取消預約
                    </button>
                    <button
                      type="button"
                      onClick={() => updateReservationStatus(reservation.reservationId, "no_show")}
                      className="h-11 rounded-2xl bg-slate-200 px-3 text-sm font-semibold text-slate-800 hover:bg-slate-300"
                    >
                      標記逾時
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function InfoMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] bg-white px-3 py-3">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}
