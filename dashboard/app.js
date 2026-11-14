// Token Launch Radar — dashboard logic. Reads window.RADAR (written by
// main.ts as data.js), renders the sortable, filterable board, and opens a
// detail view for any protocol. No network: every figure comes from the
// frozen snapshot via data.js.
(function () {
  "use strict";
  var data = window.RADAR || { meta: {}, rows: [], live: [] };
  var meta = data.meta || {};
  var ranked = data.rows || [];
  var live = data.live || [];

  var $ = function (id) { return document.getElementById(id); };
  var qEl = $("q"), catEl = $("cat"), chainEl = $("chain"),
      statusEl = $("status"), minTvlEl = $("mintvl");

  function money(n) {
    if (n === null || n === undefined) return "—";
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + Math.round(n);
  }
  function moneyFull(n) {
    if (n === null || n === undefined) return "—";
    return "$" + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function pct(n) {
    if (n === null || n === undefined) return "—";
    return (n > 0 ? "+" : "") + n.toFixed(1) + "%";
  }
  function ageText(days) {
    if (days === null || days === undefined) return "unknown";
    if (days < 30) return days + "d";
    if (days < 365) return Math.round(days / 30) + "mo";
    return (days / 365).toFixed(1) + "y";
  }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Header stats and model text.
  var stats = $("stats");
  function stat(label, value) {
    return "<div><dt>" + esc(label) + "</dt><dd>" + esc(value) + "</dd></div>";
  }
  stats.innerHTML =
    stat("Snapshot date", meta.as_of || "—") +
    stat("Protocols scanned", meta.total_protocols || 0) +
    stat("Pre-token found", meta.pre_token_protocols || 0) +
    stat("On this board", meta.ranked_rows || 0) +
    stat("Watchlist covered", (meta.watchlist_covered || 0) + " / " + (meta.watchlist_total || 0)) +
    stat("Live tokens (not ranked)", meta.live_token_protocols || 0) +
    stat("Non-launch rows excluded", meta.excluded_non_launch || 0);
  $("modeltext").textContent = meta.model_description || "";

  // Filter dropdowns, built from the data itself.
  function fillSelect(el, values) {
    values.forEach(function (v) {
      var opt = document.createElement("option");
      opt.value = v; opt.textContent = v;
      el.appendChild(opt);
    });
  }
  var cats = [], chains = [];
  ranked.concat(live).forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  fillSelect(catEl, cats.sort());
  fillSelect(chainEl, chains.sort());

  var sortKey = "value", sortDir = -1;
  var SORTS = {
    rank: function (a, b) { return (a.rank || 0) - (b.rank || 0); },
    name: function (a, b) { return String(a.name).localeCompare(String(b.name)); },
    category: function (a, b) { return String(a.category || "").localeCompare(String(b.category || "")); },
    chains: function (a, b) { return (a.chains || []).length - (b.chains || []).length; },
    tvl: function (a, b) { return a.tvl - b.tvl; },
    change: function (a, b) { return (a.change_7d || 0) - (b.change_7d || 0); },
    age: function (a, b) { return (a.age_days || 0) - (b.age_days || 0); },
    value: function (a, b) { return (a.implied_value || 0) - (b.implied_value || 0); }
  };

  function currentRows() {
    var status = statusEl.value;
    var list = status === "live" ? live.slice()
      : status === "all" ? ranked.concat(live) : ranked.slice();
    var text = qEl.value.trim().toLowerCase();
    var cat = catEl.value, chain = chainEl.value;
    var minTvl = parseInt(minTvlEl.value, 10) || 0;
    list = list.filter(function (r) {
      if (r.tvl < minTvl) return false;
      if (cat && r.category !== cat) return false;
      if (chain && (r.chains || []).indexOf(chain) < 0) return false;
      if (text) {
        var hay = (r.name + " " + r.slug + " " + (r.category || "")).toLowerCase();
        if (hay.indexOf(text) < 0) return false;
      }
      return true;
    });
    var fn = SORTS[sortKey] || SORTS.value;
    list.sort(function (a, b) { return fn(a, b) * sortDir; });
    return list;
  }

  function render() {
    var list = currentRows();
    var tbody = $("rows");
    var html = "";
    list.forEach(function (r, i) {
      var isLive = r.implied_value === undefined;
      var chg = r.change_7d;
      var chgCls = chg === null ? "" : chg >= 0 ? "pos" : "neg";
      html += '<tr data-slug="' + esc(r.slug) + '">' +
        "<td>" + (isLive ? "—" : (r.rank || i + 1)) + "</td>" +
        "<td><strong>" + esc(r.name) + "</strong> " +
          (isLive ? '<span class="badge live">LIVE TOKEN</span>'
                  : '<span class="badge">PRE-TOKEN</span>') + "</td>" +
        "<td>" + esc(r.category || "—") + "</td>" +
        "<td>" + esc((r.chains || []).slice(0, 3).join(", ")) +
          ((r.chains || []).length > 3 ? " +" + ((r.chains || []).length - 3) : "") + "</td>" +
        '<td class="num">' + money(r.tvl) + "</td>" +
        '<td class="num ' + chgCls + '">' + pct(chg) + "</td>" +
        "<td>" + ageText(r.age_days) + "</td>" +
        '<td class="num">' + (isLive ? "—" : money(r.implied_value)) + "</td></tr>";
    });
    tbody.innerHTML = html || '<tr><td colspan="8">No protocols match these filters.</td></tr>';
    var shown = list.length;
    var total = statusEl.value === "live" ? live.length
      : statusEl.value === "all" ? ranked.length + live.length : ranked.length;
    $("count").textContent = "Showing " + shown + " of " + total +
      (statusEl.value === "live" ? " live-token protocols (tokens already trade — never ranked as launch candidates)."
        : " ranked pre-token protocols.");
    document.querySelectorAll("th[data-sort]").forEach(function (th) {
      th.classList.toggle("sorted", th.getAttribute("data-sort") === sortKey);
    });
  }

  function showDetail(slug) {
    var r = ranked.filter(function (x) { return x.slug === slug; })[0];
    var isLive = !r;
    if (isLive) r = live.filter(function (x) { return x.slug === slug; })[0];
    if (!r) return;
    var body = $("detailbody");
    var html = "<h2>" + esc(r.name) + "</h2>" +
      '<p class="sub">' + esc(r.slug) + " · " + esc(r.category || "uncategorised") +
      " · " + esc((r.chains || []).join(", ")) + "</p>" +
      '<dl class="grid">' +
      "<div><dt>TVL</dt><dd>" + moneyFull(r.tvl) + "</dd></div>" +
      "<div><dt>7-day change</dt><dd>" + pct(r.change_7d) + "</dd></div>" +
      "<div><dt>Listed since</dt><dd>" + esc(r.listed_at || "unknown") + "</dd></div>" +
      "<div><dt>" + (isLive ? "Age listed" : "Age with no token") + "</dt><dd>" + ageText(r.age_days) + "</dd></div>";
    if (isLive) {
      html += "<div><dt>Token</dt><dd>" + esc(r.symbol || "trades already") + "</dd></div>" +
        "<div><dt>Implied value</dt><dd>Not ranked — its token already trades.</dd></div>";
    } else {
      html += "<div><dt>Implied value</dt><dd>" + moneyFull(r.implied_value) + "</dd></div>" +
        "<div><dt>Base (TVL × 0.40)</dt><dd>" + moneyFull(r.base_value) + "</dd></div>" +
        "<div><dt>Growth factor</dt><dd>×" + r.growth_factor + "</dd></div>" +
        "<div><dt>Age factor</dt><dd>×" + r.age_factor + "</dd></div>" +
        "<div><dt>Chain factor</dt><dd>×" + r.chain_factor + "</dd></div>" +
        "<div><dt>Category factor</dt><dd>×" + r.category_factor + "</dd></div>";
    }
    html += "</dl>";
    if (isLive) {
      html += "<p>This protocol's token already trades, so it is not a launch candidate and " +
        "carries no farm plan. It is shown here so the separation between live tokens and " +
        "pre-token launches is visible, not hidden.</p>";
    } else {
      html += "<h3>How to farm it</h3><ol class=\"steps\">" +
        r.farm_steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>";
    }
    body.innerHTML = html;
    $("detail").hidden = false;
    $("detail").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function hideDetail() {
    $("detail").hidden = true;
    $("detailbody").innerHTML = "";
  }

  // Events.
  [qEl, catEl, chainEl, statusEl, minTvlEl].forEach(function (el) {
    el.addEventListener("input", render);
    el.addEventListener("change", render);
  });
  $("reset").addEventListener("click", function () {
    qEl.value = ""; catEl.value = ""; chainEl.value = "";
    statusEl.value = "pre"; minTvlEl.value = "0";
    sortKey = "value"; sortDir = -1; hideDetail(); render();
  });
  document.querySelectorAll("th[data-sort]").forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.getAttribute("data-sort");
      if (sortKey === key) sortDir = -sortDir;
      else { sortKey = key; sortDir = key === "name" || key === "category" ? 1 : -1; }
      render();
    });
  });
  $("rows").addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-slug]");
    if (tr) showDetail(tr.getAttribute("data-slug"));
  });
  $("closedetail").addEventListener("click", function () {
    hideDetail();
    if (location.hash.indexOf("#detail/") === 0) history.replaceState(null, "", "#");
  });

  // Hash deep-linking: #detail/<slug> opens a protocol, #filter=<text> filters.
  function applyHash() {
    var hash = location.hash || "";
    if (hash.indexOf("#detail/") === 0) {
      var slug = decodeURIComponent(hash.slice("#detail/".length));
      showDetail(slug);
    } else if (hash.indexOf("#filter=") === 0) {
      qEl.value = decodeURIComponent(hash.slice("#filter=".length));
      render();
    }
  }
  window.addEventListener("hashchange", applyHash);

  render();
  applyHash();
})();
