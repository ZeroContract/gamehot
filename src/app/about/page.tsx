import type { Metadata } from "next";
import { Suspense } from "react";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "关于 — GameHot",
};

const qrCodes = [
  {
    src: "/images/小红书二维码.jpg",
    alt: "小红书二维码",
    label: "小红书",
    desc: "关注我的游戏资讯分享",
  },
  {
    src: "/images/公众号二维码.jpg",
    alt: "微信公众号二维码",
    label: "微信公众号",
    desc: "游戏圈深度内容推送",
  },
  {
    src: "/images/微信加好友二维码.png",
    alt: "微信加好友二维码",
    label: "微信好友",
    desc: "交个朋友，聊游戏开发",
  },
];

export default function AboutPage() {
  return (
    <div className="app-shell">
      <Suspense fallback={<div className="sidebar" />}>
        <Sidebar />
      </Suspense>
      <main className="app-main">
        <div className="page about-page">
          <section className="page-header">
            <div className="header-row">
              <div>
                <div className="page-title">关于</div>
              </div>
            </div>
          </section>

          <section className="about-content">
            <div className="about-intro">
              <h1 className="about-greeting">
                你好，我是<span className="about-accent">芝麻</span>
              </h1>
              <p className="about-mission">
                做这个站的目的，是希望用新时代的方式，为游戏人减少信息噪音，让真正值得看的留下来。
              </p>
            </div>

            <div className="about-divider" />

            <div className="about-qr-section">
              {qrCodes.map((qr) => (
                <div key={qr.label} className="about-qr-card">
                  <img src={qr.src} alt={qr.alt} className="about-qr-img" />
                  <div className="about-qr-info">
                    <span className="about-qr-label">{qr.label}</span>
                    <span className="about-qr-desc">{qr.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
