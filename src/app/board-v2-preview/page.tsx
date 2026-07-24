import { notFound } from "next/navigation";

import { PropertyEmpireBoardV2 } from "@/components/property-empire-board-v2";
import {
  BOARD_V2_COLOR_GROUPS,
  BOARD_V2_EXPECTED_DISTRIBUTION,
  BOARD_V2_SPACES,
  isBoardV2Property,
  type BoardV2Space,
} from "@/lib/board-v2";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(amount);
}

function getSpaceTypeLabel(space: BoardV2Space) {
  switch (space.type) {
    case "free-parking":
      return "Free Parking";
    case "go-to-jail":
      return "Go To Jail";
    default:
      return space.type.replace("-", " ");
  }
}

function renderSpaceDetails(space: BoardV2Space) {
  if (isBoardV2Property(space)) {
    return (
      <>
        <p>
          Price {formatCurrency(space.purchasePrice)} | Base rent{" "}
          {formatCurrency(space.baseRent)}
        </p>
        <p>
          Houses {space.houseRent.map(formatCurrency).join(" / ")} | Hotel{" "}
          {formatCurrency(space.hotelRent)}
        </p>
      </>
    );
  }

  if (space.type === "transit" || space.type === "utility") {
    return <p>Purchase price {formatCurrency(space.purchasePrice)}</p>;
  }

  if (space.type === "tax") {
    return <p>Amount {formatCurrency(space.amount)}</p>;
  }

  return null;
}

export default function BoardV2PreviewPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f7f8f4] px-3 py-5 text-[#171915] sm:px-6 sm:py-8 lg:px-8">
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-[linear-gradient(90deg,rgba(23,25,21,0.04)_1px,transparent_1px),linear-gradient(rgba(23,25,21,0.04)_1px,transparent_1px)] bg-[size:36px_36px]"
      />

      <div className="relative mx-auto max-w-[110rem]">
        <header className="mb-5 flex flex-col gap-4 border-b-2 border-[#171915] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 h-1 w-16 bg-[#06d6a0]" aria-hidden="true" />
            <p className="text-xs font-black uppercase text-[#596057]">
              Development Preview
            </p>
            <h1 className="mt-1 text-3xl font-black leading-none sm:text-5xl">
              Property Empire Board V2
            </h1>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs font-black uppercase sm:flex sm:text-left">
            <span className="border-2 border-[#171915] bg-white px-3 py-2">
              40 Spaces
            </span>
            <span className="border-2 border-[#171915] bg-[#e7fbf4] px-3 py-2">
              22 Properties
            </span>
            <span className="border-2 border-[#171915] bg-[#eef1ff] px-3 py-2">
              11 x 11 Grid
            </span>
          </div>
        </header>

        <section aria-labelledby="board-v2-layout-title">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase text-[#596057]">
                Perimeter Layout
              </p>
              <h2
                className="text-xl font-black sm:text-2xl"
                id="board-v2-layout-title"
              >
                40-Space City Circuit
              </h2>
            </div>
            <p className="text-right text-xs font-bold text-[#596057]">
              Indexes 0-39
            </p>
          </div>

          <div className="mx-auto w-full max-w-[min(100%,1000px)] p-1 sm:p-2">
            <PropertyEmpireBoardV2
              center={
                <div className="flex h-full w-full flex-col items-center justify-center">
                  <p className="text-[clamp(0.55rem,1.3vw,0.9rem)] font-black uppercase text-[#596057]">
                    Future Animation Stage
                  </p>
                  <h2 className="mt-2 text-[clamp(1.15rem,5vw,4.75rem)] font-black leading-none">
                    Property Empire
                  </h2>
                  <p className="mt-3 text-[clamp(0.55rem,1.2vw,0.95rem)] font-bold text-[#445045]">
                    Version 2 | 40 Spaces
                  </p>

                  <div className="mt-[clamp(0.5rem,2vw,1.5rem)] grid w-full max-w-2xl grid-cols-4 gap-[clamp(0.2rem,0.8vw,0.55rem)] sm:grid-cols-8">
                    {Object.values(BOARD_V2_COLOR_GROUPS).map((group) => (
                      <div className="min-w-0 text-center" key={group.id}>
                        <span
                          aria-hidden="true"
                          className="mx-auto block h-[clamp(0.35rem,1vw,0.75rem)] w-full border border-[#171915]"
                          style={{ backgroundColor: group.color }}
                        />
                        <span className="mt-1 block truncate text-[clamp(0.35rem,0.72vw,0.58rem)] font-black uppercase">
                          {group.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              }
              showIndexes
            />
          </div>
        </section>

        <section
          aria-labelledby="board-v2-directory-title"
          className="mt-8 border-t-2 border-[#171915] pt-6"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase text-[#596057]">
                Data Inspection
              </p>
              <h2
                className="text-2xl font-black sm:text-3xl"
                id="board-v2-directory-title"
              >
                Space Directory
              </h2>
            </div>

            <p className="max-w-2xl text-sm font-bold text-[#445045]">
              {BOARD_V2_EXPECTED_DISTRIBUTION.property} properties,{" "}
              {BOARD_V2_EXPECTED_DISTRIBUTION.transit} transit,{" "}
              {BOARD_V2_EXPECTED_DISTRIBUTION.utility} utilities,{" "}
              {BOARD_V2_EXPECTED_DISTRIBUTION.event} events,{" "}
              {BOARD_V2_EXPECTED_DISTRIBUTION.community} community, and{" "}
              {BOARD_V2_EXPECTED_DISTRIBUTION.tax} taxes.
            </p>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {BOARD_V2_SPACES.map((space) => {
              const propertyGroup = isBoardV2Property(space)
                ? BOARD_V2_COLOR_GROUPS[space.colorGroup]
                : null;

              return (
                <article
                  className="relative min-w-0 border-2 border-[#171915] bg-white p-3 shadow-[4px_4px_0_0_#171915]"
                  key={space.id}
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 w-2 border-r-2 border-[#171915]"
                    style={{ backgroundColor: space.color }}
                  />

                  <div className="ml-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-black uppercase text-[#596057]">
                        Space {space.index} |{" "}
                        {propertyGroup?.name ?? getSpaceTypeLabel(space)}
                      </p>
                      <h3 className="mt-1 break-words text-lg font-black leading-tight">
                        {space.title}
                      </h3>
                    </div>
                    <span
                      aria-hidden="true"
                      className="shrink-0 border-2 border-[#171915] px-2 py-1 text-[0.62rem] font-black"
                      style={{ backgroundColor: space.color }}
                    >
                      {space.icon}
                    </span>
                  </div>

                  <div className="ml-2 mt-3 space-y-1 text-xs font-bold leading-5 text-[#445045]">
                    <p>{space.description}</p>
                    {renderSpaceDetails(space)}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
