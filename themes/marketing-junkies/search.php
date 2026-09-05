<?php
/**
 * Search results.
 *
 * @package marketing-junkies
 */

get_header();
?>
<main id="main" class="mj-archive">
	<header class="mj-archive-head">
		<p class="mj-kicker"><?php esc_html_e( 'Search', 'marketing-junkies' ); ?></p>
		<h1><?php echo esc_html( get_search_query() ); ?></h1>
		<span class="mj-count"><?php echo esc_html( sprintf( /* translators: %s: count */ _n( '%s result', '%s results', (int) $GLOBALS['wp_query']->found_posts, 'marketing-junkies' ), number_format_i18n( (int) $GLOBALS['wp_query']->found_posts ) ) ); ?></span>
	</header>
	<?php if ( have_posts() ) : ?>
		<div class="mj-grid mj-grid-3">
			<?php while ( have_posts() ) { the_post(); mj_card( get_post(), array( 'excerpt' => true ) ); } ?>
		</div>
		<?php the_posts_pagination( array( 'class' => 'mj-pagination', 'mid_size' => 2, 'prev_text' => __( 'Newer', 'marketing-junkies' ), 'next_text' => __( 'Older', 'marketing-junkies' ) ) ); ?>
	<?php else : ?>
		<p class="mj-empty"><?php esc_html_e( 'No stories match. Try another word or browse the sections above.', 'marketing-junkies' ); ?></p>
	<?php endif; ?>
</main>
<?php
get_footer();
