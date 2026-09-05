<?php
/**
 * Campaign detail (screen 1c): hero, meta, sticky Decode TOC, structured sections, take, assets, credits, related.
 *
 * @package marketing-mentalist
 */

get_header();
the_post();
$mm_post      = get_post();
$mm_brand     = mm_get_brand( $mm_post );
$mm_agencies  = mm_get_agencies( $mm_post );
$mm_sections  = mm_get_sections( $mm_post );
$mm_assets    = mm_get_assets( $mm_post );
$mm_credits   = mm_get_credits( $mm_post );
$mm_carousel  = mm_get_carousel_ids( $mm_post );
$mm_sponsored = mm_is_sponsored( $mm_post );
$mm_hero_type = get_post_meta( $mm_post->ID, 'mm_hero_type', true ) ?: 'image';
$mm_hero_url  = get_post_meta( $mm_post->ID, 'mm_hero_url', true );
?>
<script>window.mmPageView = { event: 'campaign_view', params: { campaign: <?php echo wp_json_encode( get_the_title() ); ?> } };</script>
<article itemscope itemtype="https://schema.org/CreativeWork">
	<?php
	mm_breadcrumb( array_filter( array(
		array( home_url( '/' ), 'Home' ),
		array( get_post_type_archive_link( 'mm_campaign' ), 'Campaigns' ),
		$mm_brand ? array( get_permalink( $mm_brand ), $mm_brand->post_title ) : null,
		array( '', get_the_title() ),
	) ) );
	?>
	<section class="mm-section" style="display:grid;grid-template-columns:minmax(0,4fr) minmax(0,8fr)">
		<div style="padding:48px 44px 48px var(--gutter);border-right:var(--rule);display:flex;flex-direction:column;gap:32px">
			<div style="display:flex;flex-direction:column;gap:12px">
				<span class="mm-label mm-label-signal" style="align-self:flex-start"><?php echo $mm_sponsored ? esc_html( mm_sponsor_label() ) : 'Campaign'; ?></span>
				<?php if ( $mm_brand ) : ?>
					<div style="width:72px;height:72px;border:1px solid var(--mm-ink);display:flex;align-items:center;justify-content:center;font:700 22px/1 var(--font-display);letter-spacing:-.04em;margin-top:8px">
						<?php echo has_post_thumbnail( $mm_brand ) ? get_the_post_thumbnail( $mm_brand, array( 70, 70 ) ) : esc_html( mb_substr( $mm_brand->post_title, 0, 1 ) ); ?>
					</div>
				<?php endif; ?>
				<h1 class="mm-h1" style="font-size:52px;line-height:1;letter-spacing:-.03em;margin-top:8px" itemprop="name"><?php the_title(); ?></h1>
				<?php if ( has_excerpt() || get_post_meta( $mm_post->ID, 'mm_summary', true ) ) : ?>
					<p class="mm-standfirst"><?php echo esc_html( get_post_meta( $mm_post->ID, 'mm_summary', true ) ?: get_the_excerpt() ); ?></p>
				<?php endif; ?>
			</div>
			<dl style="margin:0;display:grid;grid-template-columns:1fr 1fr;border-top:var(--hair)">
				<?php
				$mm_meta_rows = array_filter( array(
					array( 'Brand', $mm_brand ? $mm_brand->post_title : '' ),
					array( 'Agency', $mm_agencies ? implode( ', ', wp_list_pluck( $mm_agencies, 'post_title' ) ) : '' ),
					array( 'Year', get_the_date( 'Y' ) ),
					array( 'Market', implode( ', ', wp_list_pluck( get_the_terms( $mm_post, 'mm_market' ) ?: array(), 'name' ) ) ),
					array( 'Format', implode( ', ', wp_list_pluck( get_the_terms( $mm_post, 'mm_campaign_type' ) ?: array(), 'name' ) ) ),
					array( 'Objective', implode( ', ', wp_list_pluck( get_the_terms( $mm_post, 'mm_objective' ) ?: array(), 'name' ) ) ),
				), fn( $r ) => '' !== $r[1] );
				foreach ( $mm_meta_rows as list( $k, $v ) ) :
					?>
					<div style="padding:14px 0;border-bottom:var(--hair);padding-right:16px"><dt class="mm-meta" style="margin-bottom:6px;color:var(--mm-signal)"><?php echo esc_html( $k ); ?></dt><dd style="margin:0;font:600 15px/1.2 var(--font-display)"><?php echo esc_html( $v ); ?></dd></div>
				<?php endforeach; ?>
			</dl>
			<div style="display:flex;gap:2px;flex-wrap:wrap">
				<a class="mm-tag" href="https://wa.me/?text=<?php echo rawurlencode( get_the_title() . ' ' . get_permalink() ); ?>" data-channel="whatsapp">WhatsApp</a>
				<a class="mm-tag" href="https://www.linkedin.com/sharing/share-offsite/?url=<?php echo rawurlencode( get_permalink() ); ?>" data-channel="linkedin">LinkedIn</a>
				<a class="mm-tag" href="https://x.com/intent/post?url=<?php echo rawurlencode( get_permalink() ); ?>&text=<?php echo rawurlencode( get_the_title() ); ?>" data-channel="x">X</a>
				<button class="mm-tag" type="button" data-mm-copy data-url="<?php echo esc_url( get_permalink() ); ?>" style="cursor:pointer">Copy link</button>
			</div>
		</div>
		<div class="grayscale mm-embed-facade" style="min-height:420px">
			<?php if ( has_post_thumbnail() ) : ?>
				<?php the_post_thumbnail( 'post-thumbnail', array( 'style' => 'width:100%;height:100%;object-fit:cover;position:absolute;inset:0', 'itemprop' => 'image', 'fetchpriority' => 'high' ) ); ?>
			<?php endif; ?>
			<?php if ( in_array( $mm_hero_type, array( 'youtube', 'vimeo', 'mp4' ), true ) && $mm_hero_url ) : ?>
				<button class="mm-embed-play" data-mm-embed-url="<?php echo esc_url( $mm_hero_url ); ?>" aria-label="Play">▶</button>
			<?php endif; ?>
		</div>
	</section>

	<?php if ( $mm_sponsored ) : ?>
		<div class="mm-wrap" style="padding:14px var(--gutter);background:var(--mm-bone);border-bottom:var(--hair)">
			<span class="mm-kicker" style="color:var(--mm-signal)"><?php echo esc_html( mm_sponsor_label() ); ?></span>
			<span class="mm-meta" style="text-transform:none;letter-spacing:0"> · The Marketing Mentalist newsroom was not involved in this content.</span>
		</div>
	<?php endif; ?>

	<section class="mm-section" style="display:grid;grid-template-columns:260px minmax(0,1fr) 300px">
		<?php if ( count( $mm_sections ) >= 2 ) : ?>
		<aside style="padding:48px 32px 48px var(--gutter);border-right:var(--hair)" class="mm-only-desktop">
			<div style="position:sticky;top:24px" data-mm-toc>
				<span class="mm-facet-title">Decode</span>
				<?php foreach ( $mm_sections as $i => $s ) : ?>
					<a href="#<?php echo esc_attr( $s['key'] ); ?>" style="display:grid;grid-template-columns:28px 1fr;gap:8px;padding:10px 0;border-bottom:var(--hair);font:500 14px/1.3 var(--font-display)"><span style="font:400 11px/1.6 var(--font-mono);color:var(--mm-signal)"><?php echo esc_html( $s['n'] ); ?></span><?php echo esc_html( $s['h'] ); ?></a>
				<?php endforeach; ?>
			</div>
		</aside>
		<?php else : ?>
			<div class="mm-only-desktop"></div>
		<?php endif; ?>

		<article style="padding:48px 56px;max-width:820px">
			<?php foreach ( $mm_sections as $s ) : ?>
				<section id="<?php echo esc_attr( $s['key'] ); ?>" style="display:grid;grid-template-columns:120px minmax(0,1fr);gap:24px;padding:28px 0;border-bottom:var(--hair)">
					<h2 style="font:700 11px/1.6 var(--font-mono);letter-spacing:.18em;text-transform:uppercase;color:var(--mm-signal)"><?php echo esc_html( $s['n'] . ' · ' . $s['h'] ); ?></h2>
					<div class="mm-body"><?php echo $s['html']; // phpcs:ignore WordPress.Security.EscapeOutput -- post content, already filtered. ?></div>
				</section>
			<?php endforeach; ?>

			<?php $mm_take = get_post_meta( $mm_post->ID, 'mm_take', true ); ?>
			<?php if ( $mm_take ) : ?>
				<aside class="mm-take" style="margin:40px 0 0">
					<div class="mm-take-head"><span class="mm-kicker" style="color:var(--mm-paper)">The Mentalist take</span><img src="<?php echo esc_url( MM_URI . '/assets/img/mark-dark.png' ); ?>" alt="" width="36" height="36" loading="lazy"></div>
					<p><?php echo esc_html( $mm_take ); ?></p>
				</aside>
			<?php endif; ?>

			<?php if ( $mm_assets || $mm_carousel ) : ?>
				<section style="padding:40px 0 0" data-mm-related>
					<h2 style="font:700 11px/1.6 var(--font-mono);letter-spacing:.18em;text-transform:uppercase;color:var(--mm-signal);margin-bottom:16px">Campaign assets</h2>
					<div class="mm-grid-3">
						<?php foreach ( $mm_carousel as $id ) : ?>
							<div class="mm-media mm-media-4-5 grayscale"><?php echo wp_get_attachment_image( $id, 'mm-cover', false, array( 'loading' => 'lazy' ) ); ?></div>
						<?php endforeach; ?>
						<?php foreach ( $mm_assets as $a ) : if ( 'image' === ( $a['type'] ?? '' ) ) { continue; } ?>
							<a class="mm-embed-facade mm-media mm-media-4-5" href="<?php echo esc_url( $a['url'] ); ?>" target="_blank" rel="noopener">
								<span class="mm-embed-caption"><?php echo esc_html( ucfirst( $a['type'] ) . ( $a['caption'] ? ' · ' . $a['caption'] : '' ) ); ?></span>
							</a>
						<?php endforeach; ?>
					</div>
				</section>
			<?php endif; ?>
		</article>

		<aside style="padding:48px var(--gutter) 48px 32px;border-left:var(--hair);display:flex;flex-direction:column;gap:32px" class="mm-only-desktop">
			<?php if ( $mm_credits ) : ?>
			<div>
				<span class="mm-facet-title">Credits</span>
				<dl style="margin:0">
					<?php foreach ( $mm_credits as $c ) : ?>
						<div style="display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:var(--hair);font:400 13px/1.3 var(--font-display)"><dt style="color:var(--mm-smoke)"><?php echo esc_html( $c['role'] ); ?></dt><dd style="margin:0;font-weight:600;text-align:right"><?php echo esc_html( $c['name'] ); ?></dd></div>
					<?php endforeach; ?>
				</dl>
			</div>
			<?php endif; ?>
			<?php $mm_principles = get_the_terms( $mm_post, 'mm_principle' ); if ( $mm_principles && ! is_wp_error( $mm_principles ) ) : ?>
			<div>
				<span class="mm-facet-title">Principles</span>
				<div style="display:flex;flex-wrap:wrap;gap:6px;padding-top:12px">
					<?php foreach ( $mm_principles as $p ) : ?>
						<a class="mm-tag" style="font-size:10px;padding:7px 9px" href="<?php echo esc_url( get_term_link( $p ) ); ?>"><?php echo esc_html( $p->name ); ?></a>
					<?php endforeach; ?>
				</div>
			</div>
			<?php endif; ?>
			<div class="mm-newsletter-box" id="newsletter">
				<span class="mm-kicker" style="color:var(--mm-ink)"><?php echo esc_html( get_theme_mod( 'mm_newsletter_name', 'The Brand Briefing' ) ); ?></span>
				<p class="mm-body" style="font-size:15px">One email, <?php echo esc_html( get_theme_mod( 'mm_newsletter_cadence', 'every Wednesday' ) ); ?>.</p>
				<?php mm_newsletter_form( 'campaign' ); ?>
			</div>
		</aside>
	</section>

	<?php $mm_related = mm_related_campaigns( $mm_post, 4 ); ?>
	<?php if ( $mm_related ) : ?>
		<section style="padding:56px var(--gutter) 64px" data-mm-related>
			<div class="mm-section-head" style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:24px;gap:16px">
				<h2 style="font-size:32px;letter-spacing:-.02em">You may also want to decode</h2>
				<span class="mm-meta">Same brand · same principle</span>
			</div>
			<div class="mm-grid-4">
				<?php foreach ( $mm_related as $c ) { mm_card_carousel( $c ); } ?>
			</div>
		</section>
	<?php endif; ?>
</article>
<?php get_footer(); ?>
