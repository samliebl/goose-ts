/**
 * The front page for visitors who aren’t signed in: what regoose is, what it’s
 * for, why access is by request and how to get it, plus a looping demo of the
 * tool at work (pure CSS; see public/brand/landing.css and landing.js).
 */
export function landingBody(): string {
  return `<div class="landing">
<section class="hero">
  <div class="hero-copy">
    <p class="eyebrow">A healthier reading experience</p>
    <h1>The article.<br>Nothing else.</h1>
    <p class="lede">regoose takes a cluttered web page and hands back the part you came to read: clean, plain text. No popups, no ads and no autoplay video.</p>
    <p class="cta">
      <a class="btn" href="/request-access">Request access</a>
      <a class="btn ghost" href="/login">Sign in</a>
    </p>
    <p class="muted small">Access is by invitation. <a href="#why">Here’s why.</a></p>
  </div>
  <figure class="demo" id="demo" role="img" aria-label="An animation. A web page crowded with an ad, a video, a popup and a cookie banner is cleaned up into a calm, readable article.">
    <div class="demo-bar" aria-hidden="true">
      <span class="dots"><i></i><i></i><i></i></span>
      <span class="url">news.example.com/long-article</span>
      <span class="go">Extract</span>
    </div>
    <div class="demo-stage" aria-hidden="true">
      <div class="messy">
        <div class="ad ad-top">SALE! 70% OFF EVERYTHING!!</div>
        <div class="bars title"><i></i></div>
        <div class="bars"><i></i><i></i><i></i></div>
        <div class="video"><b></b></div>
        <div class="bars"><i></i><i></i><i></i><i></i></div>
        <div class="ad ad-side">Ad</div>
        <div class="popup"><strong>Subscribe to keep reading!</strong><span class="x">×</span></div>
        <div class="cookie">We value your privacy. <u>Accept all</u></div>
      </div>
      <div class="clean">
        <h2>Why the Spruce Goose flew once</h2>
        <p class="meta">November 2, 1947</p>
        <p>The Hughes H-4 Hercules, nicknamed the Spruce Goose, flew exactly once, for about a mile at an altitude of seventy feet.</p>
        <p>Despite the nickname, it was built mostly of birch.</p>
        <p>Howard Hughes piloted it himself.</p>
      </div>
    </div>
    <figcaption>
      <span class="caps" aria-hidden="true"><span class="cap-a">A typical page</span><span class="cap-b">With regoose</span></span>
      <button class="demo-pause" type="button" aria-pressed="false">Pause</button>
    </figcaption>
  </figure>
</section>

<section class="what">
  <h2>What it does</h2>
  <div class="cards">
    <div class="card"><span class="egg" aria-hidden="true"></span><h3>Give it a page</h3><p>Paste a link or the page’s HTML. regoose finds the article in the clutter.</p></div>
    <div class="card"><span class="egg" aria-hidden="true"></span><h3>Read it calmly</h3><p>The title, the text, the date and the links, set in a serif made for reading.</p></div>
    <div class="card"><span class="egg" aria-hidden="true"></span><h3>Take it with you</h3><p>Download as plain text or JSON, one page at a time or a whole batch as a zip.</p></div>
  </div>
</section>

<section class="who">
  <img class="goose" src="/brand/mark.svg" alt="" width="150" height="150">
  <div>
    <h2>Who it’s for</h2>
    <p>Anyone who reads long articles and is tired of fighting the page to get to them. Researchers saving sources. Developers who want article extraction in their own code: regoose is built on <a href="https://github.com/samliebl/goose-ts" rel="noopener">goose-ts</a>, an open-source TypeScript library.</p>
    <p>The internet is the richest source of information in human history, and too much of it is hidden behind bad design. This is a small step toward plain text.</p>
  </div>
</section>

<section class="why" id="why">
  <h2>Why access is by request</h2>
  <p>regoose fetches other people’s pages on your behalf, and it runs on one small server paid for by one person. Opening it to everyone would invite abuse and a bill nobody can predict. So it’s by invitation: tell me what you’d like to use it for and I’ll reply by email.</p>
  <p>It obeys robots.txt, doesn’t run a page’s JavaScript and doesn’t keep what you read. The full list of limits, with the reasons, is on the <a href="/about">About page</a>.</p>
</section>

<section class="how">
  <h2>How to get access</h2>
  <ol class="steps">
    <li><span class="egg" aria-hidden="true"></span><div><h3>Request access</h3><p>Tell me a little about what you’d like to use it for.</p></div></li>
    <li><span class="egg" aria-hidden="true"></span><div><h3>Get a code by email</h3><p>If it’s a fit, I’ll send you a one-time access code.</p></div></li>
    <li><span class="egg" aria-hidden="true"></span><div><h3>Sign in with a link</h3><p>There’s no password. Each time, regoose emails you a link that works once.</p></div></li>
  </ol>
  <p class="cta">
    <a class="btn" href="/request-access">Request access</a>
    <a class="btn ghost" href="/redeem">I have an access code</a>
    <a class="btn ghost" href="/login">Sign in</a>
  </p>
</section>
</div>`;
}
