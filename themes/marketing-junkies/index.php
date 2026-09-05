<?php
/**
 * Home: lead story, six cards, newsletter band, six more cards, pagination.
 *
 * @package marketing-junkies
 */

get_header();
?>
<main id="main" class="mj-home">
	<?php if ( have_posts() ) : ?>
		<?php
		$mj_posts = $GLOBALS['wp_query']->posts;
		$mj_lead  = is_paged() ? null : array_shift( $mj_posts );
		if ( $mj_lead ) :
			$mj_lead_cat = mj_primary_category( $mj_lead );
			?>
			<section class="mj-lead" aria-label="<?php esc_attr_e( 'Lead story', 'marketing-junkies' ); ?>">
				<a class="mj-lead-media grayscale" href="<?php echo esc_url( get_permalink( $mj_lead ) ); ?>" tabindex="-1" aria-hidden="true">
					<?php echo get_the_post_thumbnail( $mj_lead, 'post-thumbnail', array( 'fetchpriority' => 'high', 'loading' => 'eager' ) ); ?>
				</a>
				<div>
					<p class="mj-kicker"><?php echo esc_html( mj_kicker( $mj_lead ) ); ?></p>
					<h1 class="mj-lead-title"><a href="<?php echo esc_url( get_permalink( $mj_lead ) ); ?>"><?php echo esc_html( get_the_title( $mj_lead ) ); ?></a></h1>
					<p class="mj-lead-standfirst"><?php echo esc_html( wp_strip_all_tags( get_the_excerpt( $mj_lead ) ) ); ?></p>
					<div class="mj-lead-meta"><?php echo esc_html( get_the_author_meta( 'display_name', $mj_lead->post_author ) ); ?> · <?php echo esc_html( get_the_date( 'j M Y', $mj_lead ) ); ?> · <?php echo esc_html( sprintf( /* translators: %d: minutes */ __( '%d min read', 'marketing-junkies' ), mj_reading_time( $mj_lead ) ) ); ?></div>
				</div>
			</section>
		<?php endif; ?>

		<?php $mj_first = array_slice( $mj_posts, 0, 6 ); $mj_rest = array_slice( $mj_posts, 6 ); ?>
		<?php if ( $mj_first ) : ?>
			<section class="mj-block" aria-label="<?php esc_attr_e( 'Latest stories', 'marketing-junkies' ); ?>">
				<div class="mj-section-head"><h2><?php echo is_paged() ? esc_html__( 'More stories', 'marketing-junkies' ) : esc_html__( 'Latest', 'marketing-junkies' ); ?></h2></div>
				<div class="mj-grid mj-grid-3"><?php foreach ( $mj_first as $p ) { mj_card( $p, array( 'excerpt' => true ) ); } ?></div>
			</section>
		<?php endif; ?>
	<?php else : ?>
		<p class="mj-empty"><?php esc_html_e( 'No stories yet. The newsroom is warming up.', 'marketing-junkies' ); ?></p>
	<?php endif; ?>
</main>

<?php get_template_part( 'template-parts/newsletter-band' ); ?>

<?php if ( ! empty( $mj_rest ) || ( have_posts() && $GLOBALS['wp_query']->max_num_pages > 1 ) ) : ?>
	<div class="mj-home">
		<?php if ( ! empty( $mj_rest ) ) : ?>
			<section class="mj-block" aria-label="<?php esc_attr_e( 'More stories', 'marketing-junkies' ); ?>">
				<div class="mj-section-head"><h2><?php esc_html_e( 'More stories', 'marketing-junkies' ); ?></h2></div>
				<div class="mj-grid mj-grid-3"><?php foreach ( $mj_rest as $p ) { mj_card( $p ); } ?></div>
			</section>
		<?php endif; ?>
		<?php
		the_posts_pagination(
			array(
				'class'     => 'mj-pagination',
				'mid_size'  => 2,
				'prev_text' => __( 'Newer', 'marketing-junkies' ),
				'next_text' => __( 'Older', 'marketing-junkies' ),
			)
		);
		?>
	</div>
<?php endif; ?>
<?php
get_footer();
