<?php get_header(); while ( have_posts() ) : the_post(); $c = fb_primary_cat(); $aid = get_the_author_meta( 'ID' ); ?>
<main id="main"><div class="wrap">
<article <?php post_class( 'single-article' ); ?>>
	<header class="article-head">
		<div class="cats">
			<?php if ( is_sticky() ) : ?><span class="tag"><?php esc_html_e( 'Big story', 'filmybuff' ); ?></span><?php endif; ?>
			<?php if ( $c ) : ?><a href="<?php echo esc_url( get_category_link( $c ) ); ?>"><?php echo esc_html( $c->name ); ?></a><?php endif; ?>
		</div>
		<h1><?php the_title(); ?></h1>
		<?php if ( has_excerpt() ) : ?><p class="dek"><?php echo esc_html( get_the_excerpt() ); ?></p><?php endif; ?>
		<div class="byline">
			<div class="byline__author">
				<?php $who = get_the_author(); if ( $who ) : ?><span class="avatar-box"><?php echo esc_html( fb_author_initials( $aid ) ); ?></span><?php endif; ?>
				<div><?php if ( $who ) : ?><strong><?php echo esc_html( $who ); ?></strong><?php endif; ?><span class="meta"><?php echo esc_html( get_the_date() ); ?> · <?php echo esc_html( fb_reading_time() ); ?></span></div>
			</div>
			<div class="byline__share">
				<a class="btn btn--ghost" href="<?php echo esc_url( 'https://api.whatsapp.com/send?text=' . rawurlencode( get_the_title() . ' ' . get_permalink() ) ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'WhatsApp', 'filmybuff' ); ?></a>
				<a class="btn btn--ghost" href="<?php echo esc_url( 'https://twitter.com/intent/tweet?url=' . rawurlencode( get_permalink() ) . '&text=' . rawurlencode( get_the_title() ) ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'Share', 'filmybuff' ); ?></a>
				<button class="btn btn--ghost js-copy" data-url="<?php the_permalink(); ?>"><?php esc_html_e( 'Copy link', 'filmybuff' ); ?></button>
			</div>
		</div>
	</header>
	<?php if ( has_post_thumbnail() ) : ?>
	<figure class="article-hero"><div class="thumb thumb--wide"><?php the_post_thumbnail( 'fb-wide' ); ?></div><?php $cap = get_the_post_thumbnail_caption(); if ( $cap ) echo '<figcaption>' . esc_html( $cap ) . '</figcaption>'; ?></figure>
	<?php endif; ?>
	<div class="entry-content"><?php the_content(); wp_link_pages(); ?></div>
	<?php $tags = get_the_tags(); if ( $tags ) : ?><div class="entry-tags"><?php foreach ( $tags as $t ) echo '<a href="' . esc_url( get_tag_link( $t ) ) . '">' . esc_html( $t->name ) . '</a>'; ?></div><?php endif; ?>
	<?php if ( get_the_author_meta( 'description' ) ) : ?>
	<div class="author-box">
		<span class="avatar-box"><?php echo esc_html( fb_author_initials( $aid ) ); ?></span>
		<div><strong><?php the_author(); ?></strong><p><?php the_author_meta( 'description' ); ?></p></div>
	</div>
	<?php endif; ?>
	<?php if ( comments_open() || get_comments_number() ) comments_template(); ?>
</article>
<?php $rel = new WP_Query( array( 'posts_per_page' => 3, 'post__not_in' => array( get_the_ID() ), 'cat' => $c ? $c->term_id : 0, 'no_found_rows' => true, 'ignore_sticky_posts' => 1 ) ); if ( $rel->have_posts() ) : ?>
<section class="related">
	<div class="section-title"><span><?php esc_html_e( 'More like this', 'filmybuff' ); ?></span></div>
	<div class="card-grid"><?php while ( $rel->have_posts() ) : $rel->the_post(); fb_card(); endwhile; wp_reset_postdata(); ?></div>
</section>
<?php endif; ?>
</div></main>
<?php endwhile; get_footer();
