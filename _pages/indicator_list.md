---
title: Indikatorenübersicht
permalink: /indicator_list/
layout: page
---

<b>Liste aller Indikatoren</b>
<br>
{% for goal in page.goals %}
  <h2>{{ goal.name }}</h2>
  {% for indicator in page.indicators %}
    {% if indicator.goal_number == goal.number %}
      <h3> <a href="{{ indicator.url }}">{{ indicator.name }}</a></h3>
    {% endif %}
  {% endfor %}
{% endfor %}
