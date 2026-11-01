import { Suspense } from "react";
import { connection } from "next/server";
import { Header } from "@/components/Header";
import { DashboardTabs } from "@/components/DashboardTabs";
import {
  SensorsPlaceholder,
  SensorsSection,
} from "@/components/SensorsSection";
import {
  WeatherPlaceholder,
  WeatherSection,
} from "@/components/WeatherSection";
import { BvgPlaceholder, BvgSection } from "@/components/BvgSection";
import { getShellySensors } from "@/lib/shelly";
import { getWeather } from "@/lib/weather";
import { getBvgDepartures } from "@/lib/bvg";

async function SensorsBlock() {
  await connection();
  try {
    const initialData = await getShellySensors();
    return <SensorsSection initialData={initialData} />;
  } catch {
    return <SensorsSection />;
  }
}

async function WeatherBlock() {
  await connection();
  try {
    const initialData = await getWeather();
    return <WeatherSection initialData={initialData} />;
  } catch {
    return <WeatherSection />;
  }
}

async function BvgBlock() {
  await connection();
  try {
    const initialData = await getBvgDepartures();
    return <BvgSection initialData={initialData} />;
  } catch {
    return <BvgSection />;
  }
}

export default function Home() {
  return (
    <div className="flex flex-1 flex-col text-foreground">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-7 sm:gap-8 sm:px-6 sm:py-10 md:max-w-3xl">
        <Header />

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
        />

        <p className="pb-2 pt-2 text-center text-[0.7rem] tracking-wide text-muted">
          RRS37 · Shelly LAN · Open-Meteo · BVG
        </p>
      </main>
    </div>
  );
}
