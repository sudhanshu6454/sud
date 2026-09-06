<?php get_header(); $term = get_queried_object(); ?>
<main id="main">
<section class="archive-head">
	<span class="kicker kicker--grey"><a href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Home', 'crazy4marketing' ); ?></a> / <?php echo is_category() ? esc_html__( 'Category', 'crazy4marketing' ) : esc_html__( 'Archive', 'crazy4marketing' ); ?></span>
	<div class="row">
		<div><h1><?php echo wp_kses_post( single_term_title( '', false ) ?: get_the_archive_title() ); ?><span>.</span></h1>
		<?php $d = term_description(); if ( $d ) echo '<p class="desc">' . wp_kses_post( wp_strip_all_tags( $d ) ) . '</p>'; ?></div>
		<span class="meta"><?php printf( esc_html( _n( '%s story', '%s stories', $GLOBALS['wp_query']->found_posts, 'crazy4marketing' ) ), esc_html( number_format_i18n( $GLOBALS['wp_query']->found_posts ) ) ); ?></span>
	</div>
</section>
<?php if ( is_category() ) : ?>
<nav class="cat-tabs" aria-label="<?php esc_attr_e( 'Categories', 'crazy4marketing' ); ?>">
	<?php foreach ( get_categories( array( 'orderby' => 'count', 'order' => 'DESC', 'number' => 8 ) ) as $c ) : ?>
	<a href="<?php echo esc_url( get_category_link( $c ) ); ?>" class="<?php echo $term && $term->term_id === $c->term_id ? 'is-active' : ''; ?>"><?php echo esc_html( $c->name ); ?></a>
	<?php endforeach; ?>
</nav>
<?php endif; ?>
<section class="archive-list"><div class="two-col"><div class="two-col__main">
	<?php if ( have_posts() ) : while ( have_posts() ) : the_post(); get_template_part( 'template-parts/list-item' ); endwhile; the_posts_pagination( array( 'mid_size' => 2, 'prev_text' => '←', 'next_text' => '→' ) ); else : ?><p><?php esc_html_e( 'Nothing here yet.', 'crazy4marketing' ); ?></p><?php endif; ?>
</div>
<aside class="sidebar"><?php c4_trending( is_category() ? sprintf( __( 'Most read in %s', 'crazy4marketing' ), $term->name ) : null, is_category() ? $term->term_id : 0 ); c4_follow_box(); dynamic_sidebar( 'sidebar-1' ); ?></aside>
</div></section>
</main>
<?php get_footer();