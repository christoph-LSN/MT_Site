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
      <h3>{{ indicator.name }}</h3>
    {% endif %}
  {% endfor %}
{% endfor %}
