"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";

export default function Header() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const isDark = stored === "dark";
    setDark(isDark);
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  return (
    <header className="app-header">
      <div className="app-header-brand">
        <div className="app-logo">
          <Image
            src="/sa-logo.png"
            alt="SA Logo"
            width={56}
            height={56}
            priority
          />
        </div>
        <h1>PRODUCTION MONITORING</h1>
      </div>
      <nav style={{ display: "flex", gap: "16px", alignItems: "center" }}>
        <Link href="/">Devices</Link>
        <Link href="/report">Reports</Link>
      </nav>
      <button
        className="theme-toggle"
        onClick={toggle}
        title={dark ? "Switch to light mode" : "Switch to dark mode"}
        aria-label="Toggle dark mode"
      >
        {dark ? "\u2600" : "\u263E"}
      </button>
    </header>
  );
}
