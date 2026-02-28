"use client";

type DataSourceCreditsProps = {
  className?: string;
};

export default function DataSourceCredits({ className = "" }: DataSourceCreditsProps) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-200 p-4 ${className}`.trim()}>
      <h3 className="text-sm font-semibold text-gray-900 mb-1">Data Sources</h3>
      <p className="text-xs text-gray-700">
        Event and match data may include information from{" "}
        <a
          href="https://www.thebluealliance.com/"
          target="_blank"
          rel="noreferrer"
          className="underline text-blue-700"
        >
          The Blue Alliance
        </a>{" "}
        and the official{" "}
        <a
          href="https://frc-events.firstinspires.org/services/API"
          target="_blank"
          rel="noreferrer"
          className="underline text-blue-700"
        >
          FIRST API
        </a>
        .
      </p>
      <p className="text-xs text-gray-600 mt-2">
        FIRST asks developers using API data to link back to the API page above in accordance with their Terms of Use.
        FIRST API data may not be used for commercial purposes.
      </p>
    </div>
  );
}
