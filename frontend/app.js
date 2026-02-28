const state = {
  token: localStorage.getItem("adminToken") || ""
};

const API_BASE = window.API_BASE_URL || "";

const tokenInput = document.getElementById("token");
const saveTokenBtn = document.getElementById("save-token");

tokenInput.value = state.token;

saveTokenBtn.addEventListener("click", () => {
  state.token = tokenInput.value.trim();
  localStorage.setItem("adminToken", state.token);
  alert("Token saved.");
});

function apiFetch(path, options = {}) {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": state.token,
      ...(options.headers || {})
    }
  }).then(async (res) => {
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err);
    }
    if (res.status === 204) return null;
    return res.json();
  });
}

async function downloadCsv(path, filename) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "x-admin-token": state.token }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function renderTable(container, rows, columns) {
  if (!rows || rows.length === 0) {
    container.innerHTML = "<p>No data yet.</p>";
    return;
  }
  const table = document.createElement("table");
  table.className = "table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  columns.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col.label;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((col) => {
      const td = document.createElement("td");
      if (col.render) {
        td.appendChild(col.render(row));
      } else {
        const value = typeof col.value === "function" ? col.value(row) : row[col.value];
        td.textContent = value ?? "";
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.innerHTML = "";
  container.appendChild(table);
}

function fillForm(form, data) {
  Object.entries(data).forEach(([key, value]) => {
    const input = form.querySelector(`[name="${key}"]`);
    if (!input) return;
    if (input.type === "checkbox") {
      input.checked = Boolean(value);
    } else {
      input.value = value ?? "";
    }
  });
}

async function loadDashboard() {
  const stats = await apiFetch("/admin/stats");
  const statsEl = document.getElementById("stats");
  statsEl.innerHTML = "";
  Object.entries(stats).forEach(([key, value]) => {
    const div = document.createElement("div");
    div.className = "stat";
    div.innerHTML = `<h4>${key}</h4><strong>${value}</strong>`;
    statsEl.appendChild(div);
  });
  loadSequenceSummary();
}

async function loadDomains() {
  const domains = await apiFetch("/admin/domains");
  renderTable(document.getElementById("domain-list"), domains, [
    { label: "Domain", value: "domain" },
    { label: "Daily", value: "dailyLimit" },
    { label: "Warmup", value: (d) => (d.warmupEnabled ? "on" : "off") },
    { label: "Warmup Start", value: "warmupStartPerDay" },
    { label: "Warmup Step", value: "warmupStepPerDay" },
    { label: "Warmup Max", value: "warmupMaxPerDay" },
    {
      label: "Edit",
      render: (row) => {
        const btn = document.createElement("button");
        btn.textContent = "Edit";
        btn.addEventListener("click", () => {
          const form = document.getElementById("domain-form");
          fillForm(form, {
            id: row.id,
            domain: row.domain,
            dailyLimit: row.dailyLimit,
            warmupStartPerDay: row.warmupStartPerDay,
            warmupStepPerDay: row.warmupStepPerDay,
            warmupMaxPerDay: row.warmupMaxPerDay,
            warmupEnabled: row.warmupEnabled
          });
        });
        return btn;
      }
    }
  ]);
}

async function loadMailboxes() {
  const mailboxes = await apiFetch("/admin/mailboxes");
  renderTable(document.getElementById("mailbox-list"), mailboxes, [
    { label: "Name", value: "name" },
    { label: "From", value: "fromEmail" },
    { label: "Domain", value: (m) => m.domain?.domain },
    { label: "Daily", value: "dailyLimit" },
    { label: "Warmup", value: (m) => (m.warmupEnabled ? "on" : "off") },
    {
      label: "Edit",
      render: (row) => {
        const btn = document.createElement("button");
        btn.textContent = "Edit";
        btn.addEventListener("click", () => {
          const form = document.getElementById("mailbox-form");
          fillForm(form, {
            id: row.id,
            name: row.name,
            domain: row.domain?.domain,
            apiKey: row.apiKey,
            fromName: row.fromName,
            fromEmail: row.fromEmail,
            replyTo: row.replyTo,
            dailyLimit: row.dailyLimit,
            warmupStartPerDay: row.warmupStartPerDay,
            warmupStepPerDay: row.warmupStepPerDay,
            warmupMaxPerDay: row.warmupMaxPerDay,
            warmupEnabled: row.warmupEnabled
          });
        });
        return btn;
      }
    }
  ]);
}

async function loadContacts() {
  const q = document.getElementById("contact-filter").value.trim();
  const contacts = await apiFetch(`/admin/contacts?take=50&q=${encodeURIComponent(q)}`);
  renderTable(document.getElementById("contact-list"), contacts, [
    { label: "Email", value: "email" },
    { label: "First", value: "firstName" },
    { label: "Last", value: "lastName" },
    { label: "Company", value: "company" },
    { label: "Opted In", value: (c) => (c.optedIn ? "yes" : "no") },
    {
      label: "Edit",
      render: (row) => {
        const btn = document.createElement("button");
        btn.textContent = "Edit";
        btn.addEventListener("click", () => {
          const form = document.getElementById("contact-form");
          fillForm(form, {
            id: row.id,
            email: row.email,
            firstName: row.firstName,
            lastName: row.lastName,
            company: row.company,
            timezone: row.timezone,
            optedIn: row.optedIn
          });
        });
        return btn;
      }
    }
  ]);
}

async function loadLists() {
  const lists = await apiFetch("/admin/lists");
  renderTable(document.getElementById("list-list"), lists, [
    { label: "Name", value: "name" },
    { label: "Description", value: "description" },
    { label: "Members", value: (l) => l.members.length },
    {
      label: "Delete",
      render: (row) => {
        const btn = document.createElement("button");
        btn.textContent = "Delete";
        btn.addEventListener("click", async () => {
          if (!confirm(`Delete list "${row.name}"?`)) return;
          await apiFetch(`/admin/lists/${row.id}`, { method: "DELETE" });
          loadLists();
        });
        return btn;
      }
    }
  ]);
}

async function loadSequenceSummary() {
  const summaries = await apiFetch("/admin/sequences/summary");
  const columns = [
    { label: "Name", value: "name" },
    { label: "Status", value: "status" },
    { label: "Steps", value: "steps" },
    { label: "Enrollments", value: "enrollments" },
    { label: "Sent", value: "sentMessages" },
    { label: "Failed", value: "failedMessages" },
    { label: "Bounced", value: "bouncedMessages" },
    { label: "Last Sent", value: (s) => (s.lastSentAt ? new Date(s.lastSentAt).toLocaleString() : "-") },
    {
      label: "Actions",
      render: (row) => {
        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.gap = "8px";

        const viewBtn = document.createElement("button");
        viewBtn.textContent = "View Messages";
        viewBtn.addEventListener("click", () => {
          const nav = document.querySelector('.nav-item[data-view="messages"]');
          if (nav) nav.click();
          const select = document.getElementById("message-sequence");
          select.value = row.id;
          loadMessages();
        });

        const delBtn = document.createElement("button");
        delBtn.textContent = "Delete";
        delBtn.addEventListener("click", async () => {
          if (!confirm(`Delete sequence "${row.name}" and all related messages?`)) return;
          await apiFetch(`/admin/sequences/${row.id}`, { method: "DELETE" });
          loadSequenceSummary();
          loadSequences();
        });

        wrap.appendChild(viewBtn);
        wrap.appendChild(delBtn);
        return wrap;
      }
    }
  ];

  const dashboardTarget = document.getElementById("sequence-summary");
  const sequencesTarget = document.getElementById("sequence-summary-list");
  const messageTarget = document.getElementById("message-sequence-summary");

  if (dashboardTarget) renderTable(dashboardTarget, summaries, columns);
  if (sequencesTarget) renderTable(sequencesTarget, summaries, columns);
  if (messageTarget) renderTable(messageTarget, summaries, columns);

  const select = document.getElementById("message-sequence");
  if (select) {
    select.innerHTML = "<option value=\"\">All sequences</option>";
    summaries.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.sentMessages} sent)`;
      select.appendChild(opt);
    });
  }
}

async function loadSequences() {
  const sequences = await apiFetch("/admin/sequences");
  renderTable(document.getElementById("sequence-list"), sequences, [
    { label: "Name", value: "name" },
    { label: "Status", value: "status" },
    { label: "Steps", value: (s) => s.steps.length },
    { label: "Window", value: (s) => `${s.sendWindowStart}-${s.sendWindowEnd}` },
    {
      label: "Edit",
      render: (row) => {
        const btn = document.createElement("button");
        btn.textContent = "Edit";
        btn.addEventListener("click", () => {
          const form = document.getElementById("sequence-form");
          fillForm(form, {
            id: row.id,
            name: row.name,
            status: row.status,
            timezonePolicy: row.timezonePolicy,
            sendWindowStart: row.sendWindowStart,
            sendWindowEnd: row.sendWindowEnd,
            daysBetween: row.daysBetween
          });
        });
        return btn;
      }
    }
  ]);
}

async function loadEnrollments() {
  const q = document.getElementById("enrollment-filter").value.trim();
  const enrollments = await apiFetch(`/admin/enrollments?take=50&q=${encodeURIComponent(q)}`);
  renderTable(document.getElementById("enrollment-list"), enrollments, [
    { label: "Contact", value: (e) => e.contact?.email },
    { label: "Sequence", value: (e) => e.sequence?.name },
    { label: "Status", value: "status" },
    { label: "Step", value: "currentStep" },
    { label: "Next", value: (e) => (e.nextSendAt ? new Date(e.nextSendAt).toLocaleString() : "-") }
  ]);
}

async function loadMessages() {
  const q = document.getElementById("message-filter").value.trim();
  const status = document.getElementById("message-status").value.trim();
  const sequenceId = document.getElementById("message-sequence").value;
  const basePath = sequenceId
    ? `/admin/sequences/${sequenceId}/messages?take=50`
    : `/admin/messages?take=50&q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}`;
  const messages = await apiFetch(basePath);
  renderTable(document.getElementById("message-list"), messages, [
    { label: "To", value: "toEmail" },
    { label: "Subject", value: "subject" },
    { label: "Status", value: "status" },
    { label: "Sent", value: (m) => (m.sentAt ? new Date(m.sentAt).toLocaleString() : "-") },
    {
      label: "Detail",
      render: (row) => {
        const btn = document.createElement("button");
        btn.textContent = "View";
        btn.addEventListener("click", async () => {
          const detail = await apiFetch(`/admin/messages/${row.id}`);
          const detailBox = document.getElementById("message-detail-body");
          detailBox.textContent = JSON.stringify(detail, null, 2);
        });
        return btn;
      }
    }
  ]);
}

async function loadEvents() {
  const type = document.getElementById("event-type").value.trim();
  const events = await apiFetch(`/admin/events?take=50&type=${encodeURIComponent(type)}`);
  renderTable(document.getElementById("event-list"), events, [
    { label: "Type", value: "type" },
    { label: "Message", value: (e) => e.message?.toEmail },
    { label: "When", value: (e) => new Date(e.occurredAt).toLocaleString() }
  ]);
}

async function loadSuppression() {
  const items = await apiFetch("/admin/suppressions");
  renderTable(document.getElementById("suppression-list"), items, [
    { label: "Email", value: "email" },
    { label: "Reason", value: "reason" },
    { label: "Date", value: (s) => new Date(s.createdAt).toLocaleDateString() }
  ]);
}

async function loadUnsubscribes() {
  const items = await apiFetch("/admin/unsubscribes");
  renderTable(document.getElementById("unsubscribe-list"), items, [
    { label: "Email", value: "email" },
    { label: "Date", value: (u) => new Date(u.createdAt).toLocaleDateString() }
  ]);
}

function wireNav() {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.view;
      document.querySelectorAll(".view").forEach((section) => {
        section.classList.toggle("active", section.id === view);
      });
      switch (view) {
        case "dashboard":
          loadDashboard();
          loadSequenceSummary();
          break;
        case "infrastructure":
          loadDomains();
          loadMailboxes();
          break;
        case "contacts":
          loadContacts();
          break;
        case "lists":
          loadLists();
          break;
        case "sequences":
          loadSequences();
          loadSequenceSummary();
          break;
        case "enrollments":
          loadEnrollments();
          break;
        case "messages":
          loadSequenceSummary();
          loadMessages();
          break;
        case "events":
          loadEvents();
          break;
        case "suppression":
          loadSuppression();
          break;
        case "unsubscribes":
          loadUnsubscribes();
          break;
      }
    });
  });
}

function formToObject(form) {
  const data = new FormData(form);
  const payload = {};
  data.forEach((value, key) => {
    if (value === "") return;
    if (value === "on") {
      payload[key] = true;
      return;
    }
    if (!Number.isNaN(Number(value)) && form.querySelector(`[name="${key}"]`)?.type === "number") {
      payload[key] = Number(value);
      return;
    }
    payload[key] = value;
  });
  return payload;
}

async function wireForms() {
  document.getElementById("domain-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = formToObject(event.target);
    if (payload.id) {
      const id = payload.id;
      delete payload.id;
      await apiFetch(`/admin/domains/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
    } else {
      await apiFetch("/admin/domains", { method: "POST", body: JSON.stringify(payload) });
    }
    event.target.reset();
    loadDomains();
  });

  document.getElementById("mailbox-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = formToObject(event.target);
    if (payload.id) {
      const id = payload.id;
      delete payload.id;
      await apiFetch(`/admin/mailboxes/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
    } else {
      await apiFetch("/admin/mailboxes", { method: "POST", body: JSON.stringify(payload) });
    }
    event.target.reset();
    loadMailboxes();
  });

  document.getElementById("contact-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = formToObject(event.target);
    payload.optedIn = Boolean(payload.optedIn ?? true);
    if (payload.id) {
      const id = payload.id;
      delete payload.id;
      await apiFetch(`/admin/contacts/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
    } else {
      await apiFetch("/admin/contacts", { method: "POST", body: JSON.stringify(payload) });
    }
    event.target.reset();
    loadContacts();
  });

  document.getElementById("import-contacts").addEventListener("click", async () => {
    const csv = document.getElementById("contact-csv").value;
    const listId = document.getElementById("contact-list-id").value.trim();
    await apiFetch("/admin/contacts/import", {
      method: "POST",
      body: JSON.stringify({ csv, listId: listId || undefined })
    });
    document.getElementById("contact-csv").value = "";
    loadContacts();
  });

  document.getElementById("list-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = formToObject(event.target);
    await apiFetch("/admin/lists", { method: "POST", body: JSON.stringify(payload) });
    event.target.reset();
    loadLists();
  });

  document.getElementById("add-list-members").addEventListener("click", async () => {
    const listId = document.getElementById("list-id").value.trim();
    const ids = document.getElementById("list-member-ids").value.split("\n").map((v) => v.trim()).filter(Boolean);
    await apiFetch(`/admin/lists/${listId}/members`, {
      method: "POST",
      body: JSON.stringify({ contactIds: ids })
    });
    loadLists();
  });

  document.getElementById("sequence-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = formToObject(event.target);
    if (payload.id) {
      const id = payload.id;
      delete payload.id;
      await apiFetch(`/admin/sequences/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
    } else {
      await apiFetch("/admin/sequences", { method: "POST", body: JSON.stringify(payload) });
    }
    event.target.reset();
    loadSequences();
  });

  document.getElementById("add-step").addEventListener("click", async () => {
    const sequenceId = document.getElementById("sequence-id").value.trim();
    const payload = {
      stepNumber: Number(document.getElementById("step-number").value),
      subjectTemplate: document.getElementById("step-subject").value,
      bodyTemplate: document.getElementById("step-body").value,
      delayDays: Number(document.getElementById("step-delay").value || 0)
    };
    await apiFetch(`/admin/sequences/${sequenceId}/steps`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    loadSequences();
  });

  document.getElementById("enroll-contact").addEventListener("click", async () => {
    const sequenceId = document.getElementById("enroll-sequence-id").value.trim();
    const contactId = document.getElementById("enroll-contact-id").value.trim();
    await apiFetch("/admin/enrollments", {
      method: "POST",
      body: JSON.stringify({ sequenceId, contactId })
    });
    loadEnrollments();
  });

  document.getElementById("dispatch-now").addEventListener("click", async () => {
    const result = await apiFetch("/admin/dispatch", { method: "POST" });
    document.getElementById("dispatch-output").textContent = JSON.stringify(result, null, 2);
  });

  document.getElementById("refresh-dashboard").addEventListener("click", loadDashboard);

  document.getElementById("quick-setup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = formToObject(event.target);
    payload.dispatchNow = Boolean(payload.dispatchNow ?? true);
    const result = await apiFetch("/admin/quick-setup", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    document.getElementById("quick-setup-output").textContent = JSON.stringify(result, null, 2);
    loadDashboard();
  });

  document.getElementById("domain-clear").addEventListener("click", () => {
    document.getElementById("domain-form").reset();
  });
  document.getElementById("mailbox-clear").addEventListener("click", () => {
    document.getElementById("mailbox-form").reset();
  });
  document.getElementById("contact-clear").addEventListener("click", () => {
    document.getElementById("contact-form").reset();
  });
  document.getElementById("sequence-clear").addEventListener("click", () => {
    document.getElementById("sequence-form").reset();
  });

  document.getElementById("contact-refresh").addEventListener("click", loadContacts);
  document.getElementById("enrollment-refresh").addEventListener("click", loadEnrollments);
  document.getElementById("message-refresh").addEventListener("click", loadMessages);
  document.getElementById("event-refresh").addEventListener("click", loadEvents);
  document.getElementById("message-sequence").addEventListener("change", loadMessages);

  document.getElementById("contact-export").addEventListener("click", () => {
    downloadCsv("/admin/contacts/export", "contacts.csv");
  });
  document.getElementById("message-export").addEventListener("click", () => {
    downloadCsv("/admin/messages/export", "messages.csv");
  });
  document.getElementById("event-export").addEventListener("click", () => {
    downloadCsv("/admin/events/export", "events.csv");
  });
}

wireNav();
wireForms();
loadDashboard();
