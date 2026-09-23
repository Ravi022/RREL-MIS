export const DASHBOARD_BODY = `<a class="skiplink" href="#mainContent">Skip to main content</a>
<div id="authOverlay" class="authwrap">
  <div class="authcard" id="authCard"></div>
</div>
<div id="appRoot" hidden>
<header class="top">
  <div class="wrap">
    <div class="brandrow">
      <div>
        <h1 class="plant">Ehoome <span>· RREL production MIS</span></h1>
        <p class="sub">Shift-wise target vs achievement across SMT, DIP/MI and FATP</p>
      </div>
      <div class="ctrls">
        <span class="dbbadge" id="dbStatus" role="status"><span class="dot"></span><span id="dbStatusText">Database online</span></span>
        <div class="datefield" style="position:relative">
          <button class="dnav" id="prevDay" title="Previous day" aria-label="Previous day">‹</button>
          <label for="dateInput" style="margin-left:2px">Date</label>
          <input type="date" id="dateInput">
          <button class="dnav" id="nextDay" title="Next day" aria-label="Next day">›</button>
          <button class="dnav" id="calBtn" title="Open calendar" aria-label="Open calendar" aria-expanded="false">📅</button>
          <div class="calpop" id="calPop" hidden></div>
        </div>
        <div class="tabs" role="tablist">
          <button role="tab" id="tabEntry" aria-selected="false" aria-controls="viewEntry">Entry</button>
          <button role="tab" id="tabDash" aria-selected="true" aria-controls="viewDash">Dashboard</button>
          <button role="tab" id="tabUsers" aria-selected="false" aria-controls="viewUsers" hidden>Users</button>
        </div>
        <div class="userbadge">
          <span class="ub-name" id="ubName"></span>
          <span class="ub-role" id="ubRole"></span>
          <button class="dnav" id="editNameBtn" title="Edit name" aria-label="Edit name">✏️</button>
          <button class="dnav" id="changePassBtn" title="Change password" aria-label="Change password">🔑</button>
          <button class="dnav" id="logoutBtn" title="Sign out" aria-label="Sign out">⏻</button>
        </div>
      </div>
    </div>
  </div>
</header>
<div id="impBanner" class="impbar" hidden></div>
<main class="wrap" id="mainContent">
  <section id="viewEntry" hidden>
    <div class="panel" style="margin-top:20px">
      <div class="panel-head">
        <div>
          <h2 id="entryTitle">Day sheet</h2>
          <p>Each shift keeps its own targets, achievement and man power.</p>
        </div>
        <div class="seg" id="shiftSeg"></div>
      </div>
      <div class="accessnotice" id="accessNotice" role="status"></div>
      <div class="scroller">
        <table class="grid">
          <thead><tr>
            <th>Production line</th><th>Sub-line</th>
            <th>Man power off role</th><th>Man power costing</th>
            <th>PCB side / stage</th><th>Item</th>
            <th style="text-align:right">Target</th><th style="text-align:right">Achievement</th>
            <th style="text-align:right">Gap</th><th style="text-align:right">Achievement %</th>
          </tr></thead>
          <tbody id="entryBody"></tbody>
        </table>
      </div>
      <div class="savebar">
        <span class="status" id="saveStatus">Not saved yet</span>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <button class="act" id="clearBtn">Clear day</button>
          <button class="act" id="copyShiftBtn">Copy this shift to the other two</button>
          <button class="act" id="copyPrevBtn">Copy from last saved day</button>
          <button class="act primary" id="saveBtn">Save day</button>
        </div>
      </div>
    </div>
  </section>
  <section id="viewDash"></section>
  <section id="viewUsers" hidden></section>
</main>
<footer class="appfooter">RREL Production MIS · Secure local database · Version 2.0</footer>
</div>
`;
