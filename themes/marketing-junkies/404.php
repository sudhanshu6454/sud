<?php
/**
 * Not found.
 *
 * @package marketing-junkies
 */

get_header();
?>
<main id="main" class="mj-archive">
	<header class="mj-archive-head">
		<p class="mj-kicker">404</p>
		<h1><?php esc_html_e( 'That page has moved on.', 'marketing-junkies' ); ?></h1>
		<p><?php esc_html_e( 'Try a search, or start from the latest stories.', 'marketing-junkies' ); ?></p>
		<p><a class="btn btn-primary" href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Latest stories', 'marketing-junkies' ); ?></a></p>
	</header>
	<section class="mj-block">
		<div class="mj-section-head"><h2><?php esc_html_e( 'Latest', 'marketing-junkies' ); ?></h2></div>
		<div class="mj-grid mj-grid-3"><?php foreach ( mj_latest_posts( 6 ) as $p ) { mj_card( $p ); } ?></div>
	</section>
</main>
<?php
get_footer();
