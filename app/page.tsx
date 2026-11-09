import { Suspense } from "react";
import { connection } from "next/server";
import { Header } from "@/components/Header";
import {
  DashboardTabPanel,
  DashboardTabs,
} from "@/components/DashboardTabs";
import { LockedPanel } from "@/components/LockedPanel";
import {
  SensorsPlaceholder,
  SensorsSection,
} from "@/components/SensorsSection";
import {
  WeatherPlaceholder,
  WeatherSection,
} from "@/components/WeatherSection";
import { BvgSection } from "@/components/BvgSection";
import { PvSection } from "@/components/PvSection";
import { SmarthomeSection } from "@/components/SmarthomeSection";
import { HeatingSection } from "@/components/HeatingSection";
import { getAuthStatus, isAuthenticated } from "@/lib/auth";
import { getShellySensors } from "@/lib/shelly";
import { getWeather } from "@/lib/weather";

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

/**
 * Session cookie + expiry (Date.now) must stay behind <Suspense> with
 * `await connection()` when Cache Components is enabled — otherwise Next
 * fails with blocking-prerender-dynamic / blocking-prerender-current-time.
 *
 * Tab bodies are children of the client tab shell (not props) so Suspense can
 * stream. Only the home tab is SSR-fetched; BVG / PV / Smarthome load on the
 * client after paint so slow Shelly cover polls cannot block first paint.
 */
async function AuthGatedHome() {
  // Session expiry uses Date.now() — must be request-time under Cache Components.
  await connection();
  const authenticated = await isAuthenticated();
  const initialAuth = await getAuthStatus();

  return (
    <>
      <Header initialAuth={initialAuth} />

      {authenticated ? (
        <DashboardTabs>
          <DashboardTabPanel id="home">
            <div className="flex flex-col gap-8">
              <Suspense fallback={<SensorsPlaceholder />}>
                <SensorsBlock />
              </Suspense>
              <hr className="section-divider" />
              <Suspense fallback={<WeatherPlaceholder />}>
                <WeatherBlock />
              </Suspense>
            </div>
          </DashboardTabPanel>

          <DashboardTabPanel id="bvg">
            <BvgSection />
          </DashboardTabPanel>

          <DashboardTabPanel id="smarthome">
            <SmarthomeSection />
          </DashboardTabPanel>

          <DashboardTabPanel id="heating">
            <HeatingSection />
          </DashboardTabPanel>

          <DashboardTabPanel id="pv">
            <PvSection />
          </DashboardTabPanel>
        </DashboardTabs>
      ) : (
        <LockedPanel />
      )}
      <Footer authenticated={authenticated} />
    </>
  );
}

function AuthGatedFallback() {
  return (
    <>
      <Header initialAuth="anonymous" />
      <LockedPanel />
      <Footer authenticated={false} />
    </>
  );
}

/** Locked visitors must not learn what the dashboard controls. */
function Footer({ authenticated }: { authenticated: boolean }) {
  return (
    <p className="pb-2 pt-2 text-center text-[0.7rem] tracking-wide text-muted">
      {authenticated
        ? "RRS37 · Shelly LAN · Open-Meteo · BVG · Heizung · PV · Smarthome"
        : "RRS37"}
    </p>
  );
}

export default function Home() {
  return (
    <div className="flex flex-1 flex-col text-foreground">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-5 py-5 sm:gap-5 sm:px-6 sm:py-7 md:max-w-3xl">
        <Suspense fallback={<AuthGatedFallback />}>
          <AuthGatedHome />
        </Suspense>
      </main>
    </div>
  );
}
