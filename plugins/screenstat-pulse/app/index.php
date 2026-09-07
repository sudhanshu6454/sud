<?php
/**
 * Admin app markup: the reference UI's body, PHP-templated. $cfg is provided by SSPulse_Admin.
 *
 * @package ScreenstatPulse
 */
defined( 'ABSPATH' ) || exit;
?>
<div id="sspulse-app">
<header class="mast">
  <div class="brand">
    <span class="eyebrow">Pre-release intelligence</span>
    <div class="brand-row"><img class="lockup" src="<?php echo esc_url( $cfg['logoWhite'] ); ?>" alt="Screenstat"><span class="product">Pulse</span></div><h1 class="sr">Screenstat Pulse</h1>
    <p>Reads a film's real-time buzz, converts it into the number of people who actually intend to buy an opening-weekend ticket, and reconciles that against screen capacity to project the collection.</p>
  </div>
  <div class="actions">
    <span class="live"><span class="dot"></span><span id="liveTxt">Recomputes on every input</span></span><span class="save-state" id="saveState" role="status" aria-live="polite"></span>
    <button class="btn" id="btnSnap" title="Store today's Buzz Index, intent and projection in this film's history">Record today's reading</button>
    <button class="btn ghost" id="btnExport">Copy data as JSON</button>
  </div>
</header>

<nav class="films" id="filmTabs" role="tablist" aria-label="Tracked films"></nav>

<section class="cal" id="calWrap">
  <div class="panel">
    <div class="panel-h"><h2>Release calendar · Hindi theatrical</h2><span class="sub"><span class="calf"><button class="fbtn on" data-f="upcoming">Upcoming</button><button class="fbtn" data-f="recent">In cinemas / recent</button><button class="fbtn" data-f="all">All</button></span></span></div>
    <div style="overflow:auto;max-height:340px"><table id="calTable"></table></div>
    <div class="src"><b>Source:</b> <span id="calSource">release calendar</span> · dates as announced, subject to change · press Track to add a film with its release date; signals are yours to fill in</div>
  </div>
</section>
<main class="pulse-wrap">
  <!-- SIGNAL DESK -->
  <aside class="panel desk" aria-label="Signal desk">
    <div class="panel-h"><h2>Signal desk</h2><span class="sub">what the market is doing right now</span></div>
    <div class="title-in">
      <input type="text" id="fTitle" aria-label="Film title" placeholder="Film title">
      <button id="btnDel" title="Remove this film">Remove</button>
    </div>
    <div id="signals"></div>
  </aside>

  <!-- READOUTS -->
  <section class="readouts">
    <div class="hero">
      <div class="panel tile">
        <div class="lab"><span>Buzz Index</span><span class="chip neu" id="buzzMomentum">—</span></div>
        <div class="gauge">
          <svg id="gauge" width="112" height="70" viewBox="0 0 112 70" aria-hidden="true"></svg>
          <div>
            <div class="val" id="buzzVal">—</div>
            <div class="desc" id="buzzBand">—</div>
          </div>
        </div>
        <div class="sub" id="buzzDrivers">—</div>
        <div class="src"><b>Source:</b> Screenstat Pulse model · 0–100 index · est.</div>
      </div>
      <div class="panel tile">
        <div class="lab"><span>Ticket intent · opening weekend</span><span class="chip neu" id="intentChip">—</span></div>
        <div class="val" id="intentVal">—</div>
        <div class="desc" id="intentDesc">—</div>
        <div class="sub" id="intentSub">—</div>
        <div class="src"><b>Source:</b> Screenstat Pulse model · opening-weekend footfalls · est.</div>
      </div>
      <div class="panel tile">
        <div class="lab"><span>Projected collection · India nett</span><span class="chip neu" id="verdict">—</span></div>
        <div class="val" id="lifeVal">—</div>
        <div class="desc" id="lifeDesc">—</div>
        <div class="range" id="lifeRange"><i></i><b></b></div>
        <div class="range-lab"><span id="lifeLo">—</span><span id="lifeHi">—</span></div>
        <div class="src"><b>Source:</b> Screenstat Pulse model · India nett · est. · <span id="srcTime"></span></div>
      </div>
    </div>

    <div class="two">
      <div class="panel">
        <div class="panel-h"><h2>Opening week, day by day</h2><span class="sub">₹ crore · median with P10–P90 band from 2,000 simulations</span></div>
        <div class="chart" id="dayChart"></div>
        <div class="legend"><span><i style="background:var(--accent)"></i>Base projection</span><span><i style="background:var(--accent-tint)"></i>P10–P90 band</span></div>
      </div>
      <div class="panel">
        <div class="panel-h"><h2>Three estimates, one number</h2><span class="sub">weighted by how sure each one is</span></div>
        <div class="cross" id="xGrid"></div>
        <div class="note" id="xNote">—</div>
        <div class="panel-h" style="border-top:1px solid var(--line)"><h2>Where the buzz comes from</h2><span class="sub">weighted contribution to index</span></div>
        <div class="chart" id="compChart"></div>
      </div>
    </div>

    <div class="two">
      <div class="panel">
        <div class="panel-h"><h2>Awareness → ticket funnel</h2><span class="sub">people, approximate</span></div>
        <div class="funnel" id="funnel"></div>
      </div>
      <div class="panel">
        <div class="panel-h"><h2>Buzz over time</h2><span class="sub" id="histSub">readings recorded for this film</span></div>
        <div class="chart" id="histChart"></div>
        <div class="note">Each reading stores the Buzz Index, intent and base projection for the day. Record one per day and the momentum chip on the Buzz tile turns live.</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-h"><h2>Audience sampling</h2><span class="sub" id="smpSub">poll real movie-goers, log every sample here</span></div>
      <div class="smp-grid">
        <div>
          <div class="smp-stats" id="smpStats"></div>
          <div style="overflow-x:auto"><table id="smpTable"></table></div>
        </div>
        <div class="smp-form">
          <h3>Add a sample</h3>
          <label>Source<select id="smSrc"></select></label>
          <div class="row2">
            <label>Respondents (n)<input type="number" id="smN" min="1" step="1" placeholder="e.g. 850"></label>
            <label>Date<input type="date" id="smDate"></label>
          </div>
          <div class="opts" id="smOpts"></div>
          <div class="actions"><button class="btn primary" id="smAdd">Add sample</button><button class="btn" id="smScript">Copy poll wording</button></div>
          <p class="hint" id="smHint"></p>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-h"><h2>Model accuracy</h2><span class="sub">enter actuals after release · the model learns k from them</span></div>
      <div class="acc-grid">
        <div class="acc-form">
          <h3>Actuals for this film · ₹ cr India nett</h3>
          <div class="row2">
            <label>Day 1<input type="number" id="acD1" min="0" step="0.1"></label>
            <label>Opening weekend<input type="number" id="acWe" min="0" step="0.1"></label>
            <label>Week 1<input type="number" id="acWk" min="0" step="0.1"></label>
            <label>Lifetime<input type="number" id="acLife" min="0" step="0.1"></label>
          </div>
          <div class="actions"><button class="btn primary" id="acSave">Save actuals</button><span class="hint" id="acLocked"></span></div>
        </div>
        <div style="overflow-x:auto"><table id="accTable"></table><div class="note" id="accNote" style="padding:10px 0 0"></div></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-h"><h2>Projection table</h2><span class="sub">₹ crore · India nett · est. · footfalls in lakh · P10 / median / P90</span></div>
      <div style="overflow-x:auto"><table id="projTable"></table></div>
    </div>

    <div class="panel method">
      <b>How the number is built.</b> Every signal is normalised on a log scale against the biggest Hindi tentpoles of recent years, so a 60 M first-day trailer scores near 100 and 1 M scores near 30. The <b>Buzz Index</b> is a weighted sum of those normalised signals; the weights are shown beside each group and add to 100. Day 1 footfalls are then estimated three independent ways. <b>Demand side</b>: BookMyShow "interested" clicks × the interested-to-footfall factor <code>k</code>, blended with unique trailer reach × an interest rate driven by like ratio and sentiment. <b>Supply side</b>: screens × shows × seats × an occupancy curve that rises with the Buzz Index, nudged for holidays and competition. <b>Audience side</b>: your own polls of movie-goers, pooled with a Wilson 95% confidence interval and discounted for enthusiast bias (followers of a film page say "definitely" far more often than the general aware public — the per-source factors and the slider under Calibration set how much). The three are combined with inverse-variance weights: a tight poll with thousands of respondents earns more weight than a rough capacity guess, and when the estimates disagree the uncertainty grows to match. That combined Day 1 and its σ feed 2,000 Monte Carlo simulations that also randomise word of mouth, ticket price and the lifetime hold, producing the P10 / median / P90 you see everywhere on this page. <b>Model accuracy</b> closes the loop: saving actuals freezes the pre-release projection, scores the error, and back-solves the <code>k</code> that would have been right, so every released film sharpens the next forecast. Figures are approximate India nett; forecast with the band, not the point.
    </div>
  </section>
</main>
<div class="tip" id="tip"></div>
</div>
