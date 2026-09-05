<?php
/**
 * Category, tag, author and date archives.
 *
 * @package marketing-junkies
 */

get_header();
$mj_term = get_queried_object();
?>
<main id="main" class="mj-archive">
	<header class="mj-archive-head">
		<p class="mj-kicker">
			<?php
			if ( is_category() ) {
				esc_html_e( 'Section', 'marketing-junkies' );
			} elseif ( is_tag() ) {
				esc_html_e( 'Topic', 'marketing-junkies' );
			} elseif ( is_author() ) {
				esc_html_e( 'Written by', 'marketing-junkies' );
			} else {
				esc_html_e( 'Archive', 'marketing-junkies' );
			}
			?>
		</p>
		<h1><?php echo wp_kses_post( get_the_archive_title() ); ?></h1>
		<?php if ( is_author() ) : ?>
			<p><?php echo esc_html( get_the_author_meta( 'description', $mj_term->ID ) ?: get_theme_mod( 'mj_author_blurb', '' ) ); ?></p>
		<?php elseif ( get_the_archive_description() ) : ?>
			<p><?php echo wp_kses_post( wp_strip_all_tags( get_the_archive_description() ) ); ?></p>
		<?php endif; ?>
		<span class="mj-count"><?php echo esc_html( sprintf( /* translators: %s: count */ _n( '%s story', '%s stories', (int) $GLOBALS['wp_query']->found_posts, 'marketing-junkies' ), number_format_i18n( (int) $GLOBALS['wp_query']->found_posts ) ) ); ?></span>
	</header>

	<?php if ( have_posts() ) : ?>
		<div class="mj-grid mj-grid-3">
			<?php while ( have_posts() ) { the_post(); mj_card( get_post(), array( 'excerpt' => true ) ); } ?>
		</div>
		<?php the_posts_pagination( array( 'class' => 'mj-pagination', 'mid_size' => 2, 'prev_text' => __( 'Newer', 'marketing-junkies' ), 'next_text' => __( 'Older', 'marketing-junkies' ) ) ); ?>
	<?php else : ?>
		<p class="mj-empty"><?php esc_html_e( 'Nothing here yet.', 'marketing-junkies' ); ?></p>
	<?php endif; ?>
</main>
<?php get_template_part( 'template-parts/newsletter-band' ); ?>
<?php
get_footer();
