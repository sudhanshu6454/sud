<?php
/**
 * Shared renderer for single-mm_brand.php and single-mm_agency.php: logo + about + tabs.
 *
 * @package marketing-mentalist
 */

defined( 'ABSPATH' ) || exit;

function mm_render_org_single( string $meta_key ): void {
	the_post();
	$org = get_post();
	$campaigns = get_posts( array( 'post_type' => 'mm_campaign', 'posts_per_page' => 12, 'meta_key' => $meta_key, 'meta_value' => $org->ID, 'no_found_rows' => true ) );
	if ( 'mm_agency_ids' === $meta_key ) {
		$campaigns = get_posts( array( 'post_type' => 'mm_campaign', 'posts_per_page' => 100, 'no_found_rows' => true ) );
		$campaigns = array_values( array_filter( $campaigns, fn( $c ) => in_array( $org->ID, array_map( 'intval', (array) get_post_meta( $c->ID, 'mm_agency_ids', true ) ), true ) ) );
	}
	?>
	<article>
		<header class="mm-section" style="padding:56px var(--gutter);display:flex;align-items:center;gap:32px">
			<div style="width:96px;height:96px;border:1px solid var(--mm-ink);display:flex;align-items:center;justify-content:center;flex:none">
				<?php echo has_post_thumbnail( $org ) ? get_the_post_thumbnail( $org, array( 96, 96 ) ) : '<span style="font:700 32px/1 var(--font-display)">' . esc_html( mb_substr( get_the_title( $org ), 0, 1 ) ) . '</span>'; ?>
			</div>
			<div>
				<h1 class="mm-h1" style="font-size:44px"><?php the_title(); ?></h1>
				<?php $website = get_post_meta( $org->ID, 'mm_website', true ); if ( $website ) : ?>
					<a href="<?php echo esc_url( $website ); ?>" target="_blank" rel="noopener" class="mm-meta"><?php echo esc_html( wp_parse_url( $website, PHP_URL_HOST ) ); ?> ↗</a>
				<?php endif; ?>
			</div>
		</header>
		<?php if ( get_the_content() ) : ?>
			<div class="mm-section mm-body" style="padding:0 var(--gutter) 56px;max-width:800px"><?php the_content(); ?></div>
		<?php endif; ?>
		<section style="padding:56px var(--gutter)">
			<h2 style="font-size:28px;margin-bottom:24px">Campaigns (<?php echo count( $campaigns ); ?>)</h2>
			<?php if ( $campaigns ) : ?>
				<div class="mm-grid-3">
					<?php foreach ( $campaigns as $c ) { mm_card_campaign( $c ); } ?>
				</div>
			<?php else : ?>
				<p class="mm-body" style="color:var(--mm-smoke)">No campaigns decoded yet.</p>
			<?php endif; ?>
		</section>
	</article>
	<?php
}
