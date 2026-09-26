<article <?php post_class( 'list-item' ); ?>>
	<div class="list-item__body">
		<?php $c = fb_primary_cat(); if ( $c ) : ?><a class="kicker" href="<?php echo esc_url( get_category_link( $c ) ); ?>"><?php echo esc_html( $c->name ); ?></a><?php endif; ?>
		<h2><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2>
		<p class="dek"><?php echo esc_html( get_the_excerpt() ); ?></p>
		<div class="meta"><?php echo esc_html( get_the_date() ); ?> · <?php echo esc_html( fb_reading_time() ); ?></div>
	</div>
	<a class="thumb thumb--1x1" href="<?php the_permalink(); ?>"><?php if ( has_post_thumbnail() ) the_post_thumbnail( 'fb-square' ); ?></a>
</article>
