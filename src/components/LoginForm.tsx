"use client";

import { useState } from "react";

export default function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(false);

    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      window.location.reload();
    } else {
      setError(true);
      setLoading(false);
    }
  }

  return (
    <div className="dashboard-login">
      <form onSubmit={handleSubmit} className="login-form">
        <h1>访问统计</h1>
        <p className="login-hint">请输入密码</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="login-input"
          placeholder="密码"
          autoFocus
        />
        {error && <p className="login-error">密码错误</p>}
        <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
          {loading ? "验证中..." : "确认"}
        </button>
      </form>
    </div>
  );
}
