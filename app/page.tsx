import { Suspense } from "react";
import { connection } from "next/server";
import { Header } from "@/components/Header";
import { DashboardTabs } from "@/components/DashboardTabs";
import { LockedPanel } from "@/components/LockedPanel";
import {
  SensorsPlaceholder,
  SensorsSection,
} from "@/components/SensorsSection";
import {
  WeatherPlaceholder,
  WeatherSection,
} from "@/components/WeatherSection";
import { BvgPlaceholder, BvgSection } from "@/components/BvgSection";
import { PvPlaceholder, PvSection } from "@/components/PvSection";
import { getAuthStatus, isAuthenticated } from "@/lib/auth";
import { getShellySensors } from "@/lib/shelly";
import { getWeather } from "@/lib/weather";
import { getBvgDepartures } from "@/lib/bvg";
import { getPvSnapshot } from "@/lib/pv";

async function SensorsBlock() {
  await connection();
  let initialData;
  try {
    initialData = await getShellySensors();
  } catch {
    initialData = undefined;
  }
  return <SensorsSection initialData={initialData} />;
}

async function WeatherBlock() {
  await connection();
  let initialData;
  try {
    initialData = await getWeather();
  } catch {
    initialData = undefined;
  }
  return <WeatherSection initialData={initialData} />;
}

async function BvgBlock() {
  await connection();
  let initialData;
  try {
    initialData = await getBvgDepartures();
  } catch {
    initialData = undefined;
  }
  return <BvgSection initialData={initialData} />;
}

async function PvBlock() {
  await connection();
  let initialData;
  try {
    initialData = await getPvSnapshot();
  } catch {
    initialData = undefined;
  }
  return <PvSection initialData={initialData} />;
}

export default async function Home() {
  await connection();
  const authenticated = await isAuthenticated();
  const initialAuth = await getAuthStatus();

  return (
    <div className="flex flex-1 flex-col text-foreground">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-7 sm:gap-8 sm:px-6 sm:py-10 md:max-w-3xl">
        <Header initialAuth={initialAuth} />

        {authenticated ? (
          <DashboardTabs
            home={
              <div className="flex flex-col gap-8">
                <Suspense fallback={<SensorsPlaceholder />}>
                  <SensorsBlock />
                </Suspense>
                <hr className="section-divider" />
                <Suspense fallback={<WeatherPlaceholder />}>
                  <WeatherBlock />
                </Suspense>
              </div>
            }
            bvg={
              <Suspense fallback={<BvgPlaceholder />}>
                <BvgBlock />
              </Suspense>
            }
            pv={
              <Suspense fallback={<PvPlaceholder />}>
                <PvBlock />
              </Suspense>
            }
          />
        ) : (
          <LockedPanel />
        )}

        <p className="pb-2 pt-2 text-center text-[0.7rem] tracking-wide text-muted">
          RRS37 · Shelly LAN · Open-Meteo · BVG · PV
        </p>
      </main>
    </div>
  );
}
