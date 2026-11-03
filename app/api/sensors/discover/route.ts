import { connection } from "next/server";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { discoverBthomeDevices } from "@/lib/shelly";
import { getShellyBindings, uniqueGatewayIps } from "@/lib/shelly-config";

/**
 * Lists BTHome devices currently paired on the configured gateway plugs.
 * Use this once to fill the sensor `mac` values in config/smarthome.yml.
 */
export const GET = withAuth(async function GET() {
  await connection();

  try {
    const hosts = uniqueGatewayIps(getShellyBindings());
    const devices = await discoverBthomeDevices(hosts);
    return NextResponse.json({
      hosts,
      devices,
      fetchedAt: new Date().toISOString(),
      hint:
        devices.length === 0
          ? "No BTHome devices found. In each Plug UI: enable Bluetooth observer, add BLU H&T, then add temperature + humidity sensors."
          : "Copy each device mac into the matching sensors entry in config/smarthome.yml.",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Discovery failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
